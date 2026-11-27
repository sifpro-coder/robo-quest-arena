# CFI Academy V6 — mise à jour ciblée (test avant production)

- 20 leçons Arduino et 20 leçons ESP32 débutant, 480 questions (12 chacune), 193 SVG, dont 58 dans les quiz. Les 48 anciens modules et leurs banques/solutions sont conservés; 26 PRO restent accessibles et 22 restent archivés.
- Progression indépendante de chaque parcours, identifiants nouveaux, correction côté serveur, conservation des notes et du code avec les tables existantes. Pour 12 questions, note entière arrondie vers le bas (8/12 minimum pour valider). Les anciens résultats, la certification et le classement PRO restent inchangés.
- Les réponses des quiz ne sont pas incluses dans academy.html; ne jamais exposer academy-bank.json ni academy-solutions.json comme fichiers statiques.

## Installation
1. Sauvegarder le dépôt GitHub actuel et la base Supabase. Ne pas recréer le projet.
2. Supabase > SQL Editor : exécuter uniquement CFI_V6_MIGRATION.sql. Ne pas relancer FRESH ni V5.4. Vérifier que la contrainte total autorise 12.
3. Extraire le ZIP. Remplacer uniquement academy.html, academy-api.js, academy-content.json, academy-bank.json et academy-solutions.json à la racine du dépôt. Ne pas supprimer d'autres fichiers; conserver les jeux et le serveur actuels. Commit, vérifier le déploiement Render.
4. Ouvrir /academy et tester avec un compte élève de test actif : ouvrir les deux premiers cours des parcours, vérifier le verrouillage du cours 2, passer 12 questions, recharger et vérifier la note enregistrée. Vérifier aussi un ancien compte PRO, le classement, la connexion et les jeux.

## Limites
Ce ZIP est un patch, pas un dépôt complet. Les jeux gardent leur banque actuelle; le raccord des nouvelles questions aux jeux, les certificats des deux nouveaux parcours, et un éditeur de cours complet restent à réaliser. Aucun changement direct sur Render ou Supabase. Vérifier les schémas/codes sur les cartes réelles avant une utilisation en classe.
