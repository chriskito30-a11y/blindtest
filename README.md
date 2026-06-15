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
- Possibilité pour les joueurs de créer leur équipe depuis le lien général si l’option est activée, sans limite fixe à 2 équipes.
- Réponse depuis téléphone avec limite de tentatives par manche.
- Classement par équipe et scores par joueur.
- Attribution automatique des points : l’app détecte artiste et/ou titre dans chaque réponse.
- En mode Artiste + titre, les deux informations sont indépendantes : le premier qui trouve l’artiste gagne les points artiste, le premier qui trouve le titre gagne les points titre.
- La manche continue tant que toutes les informations demandées ne sont pas trouvées, puis se révèle automatiquement.
- Bonus optionnel si un joueur trouve artiste + titre dans la même réponse.
- Boutons arbitre conservés en secours pour attribuer manuellement artiste/titre ou refuser une réponse.
- Écran public : chrono, QR code, nombre de joueurs, infos trouvées, révélation de la réponse.
- YouTube côté arbitre : lecteur iframe officiel, timecode de départ, lecture/pause/stop.
- Recherche YouTube intégrée si une clé YouTube Data API est saisie côté arbitre.
- Fallback sans clé API : bouton “Ouvrir YouTube” + collage d’un lien YouTube ou d’un ID vidéo.
- PWA installable : manifest, service worker, icônes classiques, icône maskable, Apple touch icon.

## Important pour YouTube

Le lecteur fonctionne avec un simple lien ou ID YouTube.

La recherche intégrée nécessite une clé YouTube Data API. La clé est mémorisée uniquement dans le navigateur de l’arbitre via `localStorage`, pas dans Firebase. Pour un vrai déploiement, il faut créer une clé API Google Cloud et la restreindre au domaine GitHub Pages ou au domaine final.

## Firebase

La configuration Firebase est dans `firebase-config.js`. Dans ce pack, elle est volontairement fournie avec des valeurs à compléter pour éviter une nouvelle alerte GitHub “secret detected”. Colle ta configuration Web Firebase restreinte au domaine de déploiement.

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
2. Dans `settings.html`, vérifier que l’option “Autoriser les joueurs à créer leur équipe” est cochée, puis copier le lien général joueur.
3. Ouvrir `screen.html` sur un ordinateur ou vidéoprojecteur.
4. Ouvrir `vote.html` sur plusieurs téléphones ou navigateurs différents, puis créer plusieurs équipes depuis la page joueur.
5. Dans `admin.html`, coller un lien YouTube, définir un timecode, saisir artiste/titre et lancer la manche.
6. Envoyer des réponses depuis les téléphones.
7. Envoyer une réponse contenant seulement l’artiste : vérifier que les points artiste sont attribués et que la manche continue.
8. Envoyer une réponse contenant le titre : vérifier que les points titre sont attribués, que YouTube se met en pause et que la réponse se révèle automatiquement.

## Limites actuelles du prototype

- Pas d’authentification Firebase réelle.
- Pas de playlist de manches sauvegardée.
- Auto-correction simple par comparaison tolérante : à vérifier pour les cas complexes, reprises, featuring, titres très courts, fautes importantes.
- Pas de retrait automatique des points si une réponse acceptée est finalement annulée.
- La recherche YouTube intégrée dépend du quota et de la configuration de la clé API.


## Nouveautés v4 — Artiste et titre séparés

Cette version ajoute une règle de jeu plus juste :

- En mode `Artiste + titre`, l’artiste et le titre sont deux objectifs séparés.
- Le premier joueur qui donne l’artiste gagne automatiquement les points artiste.
- Le premier joueur qui donne le titre gagne automatiquement les points titre.
- Une seule réponse peut contenir les deux informations et gagner les deux lots, avec un bonus optionnel.
- La manche ne s’arrête plus au premier élément trouvé : elle continue tant que toutes les informations demandées ne sont pas trouvées.
- À la fin du chrono, la réponse est révélée automatiquement même si tout n’a pas été trouvé.
- L’arbitre garde des boutons de secours pour attribuer manuellement artiste ou titre si l’auto-détection rate une réponse.

Important : l’auto-attribution se fait dans la page arbitre, car c’est elle qui lit la réponse secrète. La page arbitre doit donc rester ouverte pendant la partie.
