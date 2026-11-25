CFI ACADEMY V5.2 — ESP32 PRO • MICRO PYTHON • FRANÇAIS + TUNISIEN
=================================================================

VERSION : V5.2, mise à jour de CFI Academy V5.1 / CFI International V1.

CE QUE CONTIENT CETTE VERSION
- 26 modules ESP32 PRO selon les 5 parties du sommaire validé.
- 83 questions QCM nouvelles, corrigées côté serveur (/20) ; meilleure note sauvegardée dans Supabase.
- Cours courts en FRANÇAIS + TUNISIEN (écriture arabe), montage, matériel, code MicroPython, TP et résultat attendu.
- Interface dorée/blanche + Dark Mode, cartes par partie, progression PRO pour l'élève.
- 22 modules préexistants (7 cours + 15 TP) conservés, sans modification des conditions de l'ancienne attestation.
- Admin, mots de passe choisis par le professeur, jeu 10 joueurs, CFI Global, abonnements et comptes conservés.

FICHIERS À REMPLACER POUR UNE INSTALLATION SUR V5.1 + GLOBAL V1
  academy.html
  academy-api.js
  academy-content.json
  academy-bank.json
  academy-solutions.json

La version complète fournit tous les fichiers du projet, à téléverser uniquement si votre dépôt est bien la version V5.1/Global V1 correspondante, ou si vous souhaitez remplacer les fichiers du projet par l'ensemble livré.

INSTALLATION SUR TÉLÉPHONE ANDROID
1. Télécharger le ZIP, puis l'extraire avec «Mes fichiers».
2. Ouvrir https://github.com/sifpro-coder/robo-quest-arena/upload/main
3. Choisir les FICHIERS extraits (pas le ZIP) et les déposer à la RACINE du dépôt.
4. Commit changes. Si Render Auto Deploy est activé, le site utilise le nouveau code après déploiement.
5. Ouvrir https://cfi-robot.onrender.com/academy
6. Cliquer ESP32 PRO; vérifier les 5 parties, ouvrir une leçon.
7. Avec un compte élève ACTIF, ouvrir le quiz et remettre les réponses avec code/notes; la note passe par le serveur.
8. Avec cfi-admin, ouvrir Administration et voir les résultats des élèves.

AUCUNE MIGRATION SQL requise. Ne supprimez pas Supabase, ne changez pas les SECRETS Render.
Ne publiez pas les mots de passe / clés dans GitHub.

IMPORTANT
- La simulation électronique de type Wokwi N'EST PAS encore développée dans cette version.
- Les circuits, les servos et moteurs doivent être vérifiés par l'enseignant dans la vraie vie.
- Les exemples sont principalement destinés à la carte ESP32 CLASSIQUE. ESP32-C3/S3/S2 ont des broches et périphériques différents.
- Les nouveaux modules sont complémentaires. La certification ancienne des 22 modules reste inchangée jusqu'à une évolution explicite.
- Le paiement Konnect et l'inscription par email nécessitent toujours la configuration serveur correspondante.
- Testé localement : chargement de 48 modules au catalogue, 26 nouveaux modules, affichage leçon et quiz, syntaxe Python des exemples; validation en production et test avec Supabase réel restent à faire après déploiement.

SOURCES TECHNIQUES
https://docs.micropython.org/en/latest/esp32/quickref.html
https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html

© CFI Academy — Version 5.2
