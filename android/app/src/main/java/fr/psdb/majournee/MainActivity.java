package fr.psdb.majournee;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.CalendarContract;
import android.text.Html;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Coque Android de « Ma journée » : une WebView qui affiche l'appli web embarquée dans l'APK
 * (dossier assets/www) et lui prête deux ponts :
 *  - AndroidCalendar : lecture de l'agenda du téléphone (tous les comptes qui y sont synchronisés) ;
 *  - AndroidFiles    : enregistrement de la sauvegarde JSON dans un fichier choisi.
 * Aucune requête réseau n'est autorisée : tout reste sur le téléphone.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";

    private static final int REQ_CALENDAR = 1;
    private static final int REQ_PICK_FILE = 2;
    private static final int REQ_SAVE_FILE = 3;

    private static final int MAX_EVENTS = 500;
    private static final int MAX_PEOPLE = 12;
    private static final int MAX_DESC = 1500;

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingSaveText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);

        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new FileChooserClient());
        web.addJavascriptInterface(new CalendarBridge(), "AndroidCalendar");
        web.addJavascriptInterface(new FilesBridge(), "AndroidFiles");

        web.loadUrl(HOME);
    }

    /* ───────── Affichage de l'appli embarquée, sans réseau ───────── */

    private class LocalClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!HOST.equals(uri.getHost())) {
                return answer(403, "Forbidden"); // aucune ressource extérieure
            }
            String path = uri.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            if (path.contains("..")) return answer(403, "Forbidden");
            try {
                InputStream in = getAssets().open("www" + path);
                return new WebResourceResponse(mimeOf(path), "utf-8", in);
            } catch (IOException e) {
                return answer(404, "Not Found");
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (HOST.equals(uri.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri)); // liens externes : dans le navigateur
            } catch (ActivityNotFoundException ignored) {
                // rien à ouvrir : on ne fait rien
            }
            return true;
        }
    }

    private static WebResourceResponse answer(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason,
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeOf(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".webmanifest") || path.endsWith(".json")) return "application/manifest+json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    /* ───────── Sélecteur de fichiers (import .ics, restauration) ───────── */

    private class FileChooserClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = callback;
            try {
                startActivityForResult(params.createIntent(), REQ_PICK_FILE);
            } catch (ActivityNotFoundException e) {
                filePathCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_PICK_FILE) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
        } else if (requestCode == REQ_SAVE_FILE) {
            boolean ok = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingSaveText != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    if (out != null) {
                        out.write(pendingSaveText.getBytes(StandardCharsets.UTF_8));
                        ok = true;
                    }
                } catch (IOException ignored) {
                    // ok reste faux : la page affichera « annulée »
                }
            }
            pendingSaveText = null;
            runJs("window.onFileSaved && window.onFileSaved(" + ok + ")");
        }
    }

    /* ───────── Pont : enregistrer un fichier ───────── */

    private class FilesBridge {
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingSaveText = text;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(mime);
                    intent.putExtra(Intent.EXTRA_TITLE, name);
                    startActivityForResult(intent, REQ_SAVE_FILE);
                }
            });
        }
    }

    /* ───────── Pont : agenda du téléphone ───────── */

    private class CalendarBridge {

        @JavascriptInterface
        public boolean hasPermission() {
            return checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    requestPermissions(new String[]{Manifest.permission.READ_CALENDAR}, REQ_CALENDAR);
                }
            });
        }

        /** Liste des agendas du téléphone : [{id, name, account, visible}] */
        @JavascriptInterface
        public String listCalendars() {
            JSONArray out = new JSONArray();
            if (!hasPermission()) return out.toString();
            String[] projection = {
                    CalendarContract.Calendars._ID,
                    CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                    CalendarContract.Calendars.ACCOUNT_NAME,
                    CalendarContract.Calendars.VISIBLE
            };
            try (Cursor c = getContentResolver().query(CalendarContract.Calendars.CONTENT_URI, projection,
                    null, null, CalendarContract.Calendars.ACCOUNT_NAME + ", "
                            + CalendarContract.Calendars.CALENDAR_DISPLAY_NAME)) {
                while (c != null && c.moveToNext()) {
                    JSONObject o = new JSONObject();
                    o.put("id", String.valueOf(c.getLong(0)));
                    o.put("name", orEmpty(c.getString(1)));
                    o.put("account", orEmpty(c.getString(2)));
                    o.put("visible", c.getInt(3) == 1);
                    out.put(o);
                }
            } catch (Exception e) {
                return "null";
            }
            return out.toString();
        }

        /**
         * Événements avec horaire entre deux dates (millisecondes), récurrences déjà développées :
         * [{key, title, begin, end, place, desc, people}]. Renvoie "null" en cas d'erreur.
         */
        @JavascriptInterface
        public String getEvents(String startMs, String endMs, String calendarIds) {
            JSONArray out = new JSONArray();
            if (!hasPermission()) return "null";
            String ids = calendarIds == null ? "" : calendarIds.replaceAll("[^0-9,]", "");
            if (ids.isEmpty()) return out.toString();
            try {
                long start = Long.parseLong(startMs);
                long end = Long.parseLong(endMs);
                ContentResolver resolver = getContentResolver();

                Uri.Builder builder = CalendarContract.Instances.CONTENT_URI.buildUpon();
                ContentUris.appendId(builder, start);
                ContentUris.appendId(builder, end);

                // Colonnes de base, puis colonnes d'état (annulé / refusé) ; si le fournisseur
                // d'agenda refuse ces dernières, on se contente des colonnes de base.
                String[] base = {
                        CalendarContract.Instances.EVENT_ID,        // 0
                        CalendarContract.Instances.BEGIN,           // 1
                        CalendarContract.Instances.END,             // 2
                        CalendarContract.Instances.TITLE,           // 3
                        CalendarContract.Instances.EVENT_LOCATION,  // 4
                        CalendarContract.Instances.DESCRIPTION,     // 5
                        CalendarContract.Instances.ALL_DAY          // 6
                };
                String[] withState = {
                        base[0], base[1], base[2], base[3], base[4], base[5], base[6],
                        CalendarContract.Instances.STATUS,                // 7
                        CalendarContract.Instances.SELF_ATTENDEE_STATUS   // 8
                };
                String selection = CalendarContract.Instances.CALENDAR_ID + " IN (" + ids + ")";
                String order = CalendarContract.Instances.BEGIN + " ASC";

                boolean hasState = true;
                Cursor c = null;
                try {
                    c = resolver.query(builder.build(), withState, selection, null, order);
                } catch (Exception ignored) {
                    c = null;
                }
                if (c == null) {
                    hasState = false;
                    c = resolver.query(builder.build(), base, selection, null, order);
                }
                if (c == null) return "null";

                List<JSONObject> events = new ArrayList<JSONObject>();
                Set<Long> eventIds = new LinkedHashSet<Long>();
                try {
                    while (c.moveToNext() && events.size() < MAX_EVENTS) {
                        if (c.getInt(6) == 1) continue; // « toute la journée » : ce n'est pas une réunion
                        if (hasState) {
                            if (c.getInt(7) == CalendarContract.Events.STATUS_CANCELED) continue;
                            if (c.getInt(8) == CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED) continue;
                        }
                        long eventId = c.getLong(0);
                        long begin = c.getLong(1);
                        JSONObject o = new JSONObject();
                        o.put("key", eventId + "@" + begin);
                        o.put("eventId", eventId);
                        o.put("title", orEmpty(c.getString(3)));
                        o.put("begin", begin);
                        o.put("end", c.getLong(2));
                        o.put("place", orEmpty(c.getString(4)));
                        o.put("desc", cleanDescription(c.getString(5)));
                        events.add(o);
                        eventIds.add(eventId);
                    }
                } finally {
                    c.close();
                }

                Map<Long, String> people = attendees(resolver, eventIds);
                for (JSONObject o : events) {
                    o.put("people", orEmpty(people.get(o.getLong("eventId"))));
                    o.remove("eventId");
                    out.put(o);
                }
                return out.toString();
            } catch (Exception e) {
                return "null";
            }
        }
    }

    /** Participants de chaque événement, sous forme « Nom, Nom, +3 ». */
    private Map<Long, String> attendees(ContentResolver resolver, Set<Long> eventIds) {
        Map<Long, String> result = new HashMap<Long, String>();
        if (eventIds.isEmpty()) return result;

        StringBuilder in = new StringBuilder();
        for (Long id : eventIds) {
            if (in.length() > 0) in.append(',');
            in.append(id.longValue());
        }
        Map<Long, LinkedHashSet<String>> names = new HashMap<Long, LinkedHashSet<String>>();
        String[] projection = {
                CalendarContract.Attendees.EVENT_ID,
                CalendarContract.Attendees.ATTENDEE_NAME,
                CalendarContract.Attendees.ATTENDEE_EMAIL
        };
        try (Cursor c = resolver.query(CalendarContract.Attendees.CONTENT_URI, projection,
                CalendarContract.Attendees.EVENT_ID + " IN (" + in + ")", null, null)) {
            while (c != null && c.moveToNext()) {
                String name = orEmpty(c.getString(1)).trim();
                if (name.isEmpty()) name = orEmpty(c.getString(2)).trim();
                if (name.isEmpty()) continue;
                LinkedHashSet<String> set = names.get(c.getLong(0));
                if (set == null) {
                    set = new LinkedHashSet<String>();
                    names.put(c.getLong(0), set);
                }
                set.add(name);
            }
        } catch (Exception e) {
            return result; // pas de participants plutôt que pas d'événements
        }
        for (Map.Entry<Long, LinkedHashSet<String>> entry : names.entrySet()) {
            StringBuilder sb = new StringBuilder();
            int shown = 0;
            for (String n : entry.getValue()) {
                if (shown == MAX_PEOPLE) break;
                if (shown > 0) sb.append(", ");
                sb.append(n);
                shown++;
            }
            int rest = entry.getValue().size() - shown;
            if (rest > 0) sb.append(", +").append(rest);
            result.put(entry.getKey(), sb.toString());
        }
        return result;
    }

    private static String cleanDescription(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        String text = Html.fromHtml(raw, Html.FROM_HTML_MODE_LEGACY).toString()
                .replace(' ', ' ').replace('￼', ' ')
                .replaceAll("[ \\t]+", " ").replaceAll("\\n{3,}", "\n\n").trim();
        return text.length() > MAX_DESC ? text.substring(0, MAX_DESC) + "…" : text;
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }

    /* ───────── Retours vers la page ───────── */

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CALENDAR) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            runJs("window.onCalendarPermission && window.onCalendarPermission(" + granted + ")");
        }
    }

    private void runJs(final String js) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(js, null);
            }
        });
    }

    /** Retour : ferme d'abord la fiche de réunion si elle est ouverte, sinon quitte l'appli. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript(
                "(function(){var d=document.getElementById('meeting-dialog');"
                        + "if(d&&d.open){d.close();return 'closed';}return 'none';})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"\"closed\"".equals(value)) MainActivity.super.onBackPressed();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
