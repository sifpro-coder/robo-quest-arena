# CFI V7.5 — XP, classement et pseudo unique
Base : V7.4.1 + Academy V7.4. Conserver les autres fichiers et les données.
1. Exécuter CFI_V7_5_MIGRATION.sql dans Supabase SQL Editor, sur le projet existant. Ne pas refaire les migrations précédentes.
2. Sur GitHub (racine de main), déposer ensemble les 12 fichiers HTML/JS du ZIP, pas le SQL ni ce README. Ne pas supprimer questions.json, package.json, home.html ou les fichiers academy-content/bank/solutions.json existants.
3. Commit, puis vérifier le déploiement Render et /health (version 7.5.0). Ne pas redémarrer pendant une partie.
4. Mon espace : un élève actif choisit une fois son pseudo unique (3–18 lettres latines, chiffres, underscore). Il est réutilisé dans les jeux serveur et le classement. Le serveur ignore les noms fournis par le navigateur pour les comptes. Le pseudo doit être non nominatif ; les invités affichent Guest_ et sont uniques dans leur salle, sans XP permanent. Les anciens comptes et achats sont conservés.
5. XP: 50 par étape validée, jusqu'à 20 par partie serveur terminée, maximum 100 XP jeux/jour UTC, classement Top 20, historique des 30 dernières parties. Les parties solo purement locales ne sont pas enregistrées. Les résultats anciens de cours sont repris, pas les anciennes parties non stockées.
6. Vérifier deux comptes avec le même pseudo (même avec casse différente), deux invités homonymes dans une salle, reconnexion, code universel, fin de partie et Mon espace.
Tests effectués ici : syntaxe JS serveur et scripts HTML ; tests unitaires de résolution de nom, rejet des doublons et calcul de résultat avec DB simulée. Pas de test de Supabase réel ni de navigateur Render. La migration SQL doit réussir avant le déploiement.
