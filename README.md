# Ma journée 📱

Application Android (PWA) pour noter les tâches du jour et obtenir le briefing de ses réunions.

## Ce qu'elle fait

- **Aujourd'hui** : un briefing de la journée (réunions, tâches, priorités), la réunion en cours, les chevauchements, les créneaux libres et un aperçu du lendemain. Le bouton 🔊 lit le briefing à voix haute.
- **Tâches** : ajout avec date et priorité ⭐, report au lendemain ➡️. Les tâches non faites sont reportées automatiquement au jour suivant.
- **Réunions** : fiche avec horaires, lieu, participants, objectif, éléments à préparer et notes. Import d'un fichier `.ics` exporté depuis Google Agenda ou Outlook.
- **Plus** : sauvegarde et restauration (fichier JSON), ménage des éléments passés.

Les données restent sur le téléphone, rien n'est envoyé ailleurs. L'application fonctionne hors connexion.

## Mise en ligne (une seule fois)

1. Fusionner la branche dans `main`.
2. Sur GitHub : **Settings → Pages → Source : GitHub Actions**.
3. L'adresse s'affiche ensuite dans l'onglet **Actions** (de la forme `https://<compte>.github.io/OptW/`).

## Installation sur Android

Ouvrir l'adresse dans Chrome, puis menu **⋮ → Installer l'application** (ou « Ajouter à l'écran d'accueil »).

## Limites actuelles

- Les réunions récurrentes d'un `.ics` ne sont importées qu'à leur première occurrence.
- Pas encore de synchronisation automatique avec Google Agenda ni de notifications de rappel.
