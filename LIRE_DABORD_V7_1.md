# CFI ROBOT GLOBAL — V7.1

Prérequis : V7.0 installée. Conserver une sauvegarde de la base et du dépôt GitHub avant modification.

1. Supabase : exécuter le contenu de CFI_V7_1_MIGRATION.sql dans le SQL Editor de la base existante. Migration additive, aucun effacement.
2. GitHub : téléverser ensemble à la racine `home.html`, `server.js`, `academy.html`, `academy-api.js`. Ne pas remplacer `index.html` : il contient l'ancienne Arena, désormais servie aussi sous `/arena`. Conserver tous les JSON, jeux et autres fichiers. Ne pas téléverser les guides/SQL. Le server.js fourni dérive du fichier V5.6.0 précédemment transmis; si vous avez modifié le serveur depuis, fusionner ses routes au lieu de l'écraser.
3. Render : attendre la fin du déploiement et ouvrir `/`. Contrôler `/health`, `/academy`, `/arena`, `/snake`, `/battle`. Les anciennes invitations `/?room=...` continuent à servir Arena. `/index.html` reste également l'Arena.
4. Admin : dans Prix Lifetime, les clés TRAFFIC et HOME correspondent aux deux projets disponibles. Attribution manuelle : sélectionner le projet dans le bouton Lifetime de l'élève. Achat séparé permanent, sous réserve de fonctionnement de la plateforme et du compte actif. Les deux premiers TP restent gratuits; chaque étape exige 12/20 à la précédente. Les anciens droits Arduino/ESP32 et Premium continuent de donner accès aux projets inclus. Vérifier avec un compte test sans abonnement et un autre Premium.

Les prix initiaux (9 DT et 19 DT) sont modifiables via Admin. Aucun matériel physique inclus. Aucun paiement automatique de projet, historique de transactions, championnat ou traduction complète du contenu n'est ajouté. Seul l'accueil est FR/EN/AR. Les projets non finalisés ne sont pas vendus. Les prix de l'accueil sont lus via l'API; hors connexion ils ne s'affichent pas.

Tests effectués : syntaxe Node, assertions locales de droits et prérequis, routes HTTP avec jeu de questions factice (non inclus dans le ZIP). Vérification navigateur isolée de l'accueil (langues, largeur mobile, tarifs simulés). Pas de test de la base Supabase réelle, de Render, de paiement ou de partie multijoueur.

Retour arrière : restaurer les quatre fichiers modifiés (ou retirer home.html et restaurer server.js). Garder les nouvelles colonnes et tarifs; les droits de projet ne seront reconnus à nouveau qu'avec V7.1.
