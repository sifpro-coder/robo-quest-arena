CFI ACADEMY V5.4 — SMART PROGRESSION / LEADERBOARD / MASTER ROBOT
===================================================================
Base: V5.3 ESP32 Formation Complète (26 modules, 135 questions). Courant: V5.4.

FONCTIONS EFFECTIVES DANS LE CODE :
- Les 22 cours historiques sont masqués dans le catalogue et refusés aux étudiants (données conservées).
- 26 cours ESP32 PRO organisés en 5 parties, leçon 01 accessible en premier.
- 12/20 dans le QCM du cours précédent => déverrouillage du cours suivant.
- 20/20 => cours maîtrisé, une pièce supplémentaire sur le robot de progression (2D CSS, pas un simulateur 3D).
- Le déblocage, la note maximale et le certificat sont vérifiés côté Node, jamais par le navigateur seulement.
- Enregistrement de chaque tentative QCM : sécurité antirejeu, compteur d'essais, jours d'activité, meilleur score.
- Ranking privé en pseudonymes : 25% jours d'activité avec QCM sur les 7 derniers jours, 35% efficience des essais pour les leçons maîtrisées, 40% de 26 leçons maîtrisées.
- Certificat numérique auto lorsque les 26 QCM affichent 20/20. Impression / enregistrer PDF via navigateur, lien de vérification.
- Texte FR + Tunisien, TP et contenu V5.3 préservés. Jeu Arena, abonnements et comptes existants préservés.

IMPORTANT :
* La certification est NUMÉRIQUE, pas une certification de montage physique ni un correcteur MicroPython sur un ESP32 réel.
* Les scores QCM sont corrigés automatiquement par Node; le code/TP ne sont PAS exécutés ni notés par un moteur matériel.
* Classement « présence » = jours d'activité quiz en ligne, non présence en classe.
* Robot = interface visuelle 2D basée sur l'avancement, non véritable robot programmable/3D.
* Le QR de vérification fonctionne via la dépendance npm qrcode-terminal. Vérifier que Render exécute npm install après mise à jour de package.json. Si le module manque, le lien reste visible.
* Les QCM de 5 questions varient par ordre des questions et choix. La banque n'a pas encore plusieurs ensembles alternatifs par leçon.
* Besoin de SQL migration; impossible d'enregistrer les tentatives avant installation du tableau.

INSTALLATION (IMPORTANT — DANS CET ORDRE):
1. Sauvegarder ton projet sur GitHub et tes données Supabase.
2. Supabase > SQL Editor : exécuter le fichier CFI_V5_4_MIGRATION.sql UNE FOIS.
3. Depuis le ZIP « UPDATE_6_FICHIERS », remplacer à la RACINE de GitHub :
   academy.html ; academy-api.js ; academy-content.json ; academy-bank.json ; academy-solutions.json ; package.json.
   (server.js reste inchangé; il charge automatiquement academy-api.js.)
4. Commit changes, attendre la fin de l'auto-déploiement Render.
5. Tester avec un COMPTE ÉLÈVE de démonstration :
   - leçon 02 bloquée sans 12/20 à la 01;
   - 12/20 à la 01 libère la 02 mais la 01 reste orange;
   - 20/20 à la 01 attribue une pièce de robot et rend la 01 verte;
   - chaque tentative augmente le compteur;
   - Classement montre un pseudonyme, activité 7j, essais et progression;
   - les 22 leçons historiques ne sont pas visibles;
   - aucun certificat tant que 26/26 ne sont pas 20/20;
   - après 26/26 le certificat numérique se délivre automatiquement avec QR et lien de vérification.
6. Si la migration échoue, ne pas publier la mise à jour avant correction : la fonctionnalité de tentatives en dépend.

SÉCURITÉ:
- Ne jamais mettre de clé Supabase service role dans le navigateur ou GitHub.
- Vérification du Quiz et des verrouillages au serveur.
- Les pseudonymes n'exposent pas les noms réels de mineurs.
- Protéger l'accès par abonnement suivant les paramètres existants.

TESTS LOCAUX:
- Node --check academy-api.js ; script JS embarqué ; vérification JSON, SQL, taille des cours.
- Vérifier également sur Render/Supabase réel après le déploiement.
