# BlindTest Master — Prototype PWA

Prototype autonome de blind test live pour Fais Ton Show.

## Pages

- `index.html` : créer ou ouvrir une partie.
- `settings.html?room=...` : régler la partie, les points, les équipes, les liens et QR codes.
- `admin.html?room=...` : console arbitre avec lecteur YouTube iframe, lancement de manche, validation des réponses et scores.
- `vote.html?room=...` : page joueurs sur téléphone, avec choix/création d’équipe et réponse rapide.
- `vote.html?room=...&team=equipe-rouge` : lien direct pour rejoindre une équipe précise.
- `screen.html?room=...` : écran vidéoprojecteur avec QR code, chrono, gagnant, réponse révélée et classement.

## Fonctionnalités incluses

- Création d’une partie protégée par mot de passe arbitre.
- Équipes configurables avec couleur, score, lien d’invitation et QR code.
- Possibilité pour les joueurs de créer leur équipe si l’option est activée.
- Réponse depuis téléphone avec limite de tentatives par manche.
- Classement par équipe et scores par joueur.
- Validation manuelle par l’arbitre : accepter/refuser une réponse.
- Points configurables : 1er, 2e et 3e bon répondant.
- Écran public : chrono, QR code, nombre de joueurs, premier bon répondant, révélation de la réponse.
- YouTube côté arbitre : lecteur iframe officiel, timecode de départ, lecture/pause/stop.
- Recherche YouTube intégrée si une clé YouTube Data API est saisie côté arbitre.
- Fallback sans clé API : bouton “Ouvrir YouTube” + collage d’un lien YouTube ou d’un ID vidéo.
- PWA installable : manifest, service worker, icônes classiques, icône maskable, Apple touch icon.

## Important pour YouTube

Le lecteur fonctionne avec un simple lien ou ID YouTube.

La recherche intégrée nécessite une clé YouTube Data API. La clé est mémorisée uniquement dans le navigateur de l’arbitre via `localStorage`, pas dans Firebase. Pour un vrai déploiement, il faut créer une clé API Google Cloud et la restreindre au domaine GitHub Pages ou au domaine final.

## Firebase

La configuration Firebase est dans `firebase-config.js`.

Le prototype utilise le chemin Realtime Database :

```txt
blindRooms/{roomId}
```

Pour tester rapidement, publier les règles contenues dans `database.rules.json` :

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    },
    "blindRooms": {
      ".read": true,
      ".write": true
    }
  }
}
```

Ces règles sont ouvertes pour un prototype. Pour une version publique sérieuse, il faudra ajouter Firebase Authentication, séparer les droits arbitre/joueur/écran et fermer les écritures publiques.

## Données sensibles de manche

Le titre et l’artiste attendus ne sont pas envoyés dans le nœud public `currentRound` pendant la manche. Ils sont copiés vers l’écran uniquement au moment de la révélation. Avec les règles ouvertes du prototype, un utilisateur avancé pourrait tout de même lire directement la base Firebase ; ce n’est donc pas une sécurité forte, seulement une protection UX pour les joueurs ordinaires.

## Déploiement GitHub Pages

1. Dézipper le dossier.
2. Mettre les fichiers à la racine du dépôt GitHub Pages.
3. Publier les règles Firebase si le chemin `blindRooms` n’est pas encore autorisé.
4. Ouvrir `index.html`.
5. Créer une partie, puis ouvrir les pages Réglages, Arbitre, Joueurs et Écran.

## Tests recommandés

1. Créer une partie depuis `index.html`.
2. Dans `settings.html`, créer 2 ou 3 équipes et copier les liens d’équipe.
3. Ouvrir `screen.html` sur un ordinateur ou vidéoprojecteur.
4. Ouvrir `vote.html` sur deux téléphones ou deux navigateurs différents.
5. Dans `admin.html`, coller un lien YouTube, définir un timecode, saisir artiste/titre et lancer la manche.
6. Envoyer des réponses depuis les téléphones.
7. Accepter une réponse côté arbitre, vérifier l’affichage du gagnant et le score écran.
8. Cliquer sur “Révéler” pour afficher la bonne réponse.

## Limites actuelles du prototype

- Pas d’authentification Firebase réelle.
- Pas de playlist de manches sauvegardée.
- Pas d’auto-correction intelligente des réponses.
- Pas de retrait automatique des points si une réponse acceptée est finalement annulée.
- La recherche YouTube intégrée dépend du quota et de la configuration de la clé API.

