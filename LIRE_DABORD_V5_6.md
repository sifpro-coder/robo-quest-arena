# CFI Academy V5.6 — Games & Battle (version de test)

**Aucune modification n'a été publiée automatiquement sur GitHub, Render ou Supabase.**

## Nouveautés vérifiables dans le code
- `/battle` : combat de robots/mini tanks 2D. Salle à 6 chiffres, 12 joueurs, rejoindre une salle en cours, reprise de session dans le même navigateur tant que le processus serveur maintient la partie. Version **Démo** gratuite sans équipement persistant ; **Premium** uniquement avec un compte étudiant actif connecté à l'Academy. Le serveur valide les réponses aux questions du cursus ESP32 et attribue **10 points** pour une bonne réponse, puis une récompense parmi 6 outils. En Premium seulement, l'outil est écrit dans Supabase et ne disparaît pas après une défaite.
- **Snake** : durée 1–5 minutes réglable ; questions de leçons ESP32 sélectionnées de 1 à N ; bonne réponse **10 points** et **+1 segment** ; composants **+1 segment** avec taille maximale 40 ; classements avec tous les participants, bord sans collision, grand mange petit.
- **Arena et Quiz Live** : durée de salle paramétrable 1–5 minutes depuis la page d'accueil. Classement visible.
- **Mobile / PC** : affichages adaptatifs et noms visibles au-dessus des personnages (interfaces HTML existantes).

## Installation conseillée
1. Garder une copie/branche GitHub de la version actuelle. Ne **pas** téléverser l'archive ZIP directement dans le dépôt : extraire les fichiers et téléverser leur contenu dans la racine du dépôt.
2. Dans le projet Supabase actuel, **SQL Editor** : exécuter le seul fichier `CFI_V5_6_BATTLE_INVENTORY.sql` (pas les anciens schémas complets). Pour une session Démo seule en test local, ce SQL n'est pas nécessaire.
3. Télécharger le contenu du ZIP de mise à jour dans GitHub en conservant la structure existante ; **Commit**. Render doit déployer avec Node `npm start`. Aucune clé Supabase ne doit être transmise au navigateur ou copiée dans GitHub.
4. Contrôler `https://cfi-robot.onrender.com/health`, `/academy`, `/snake`, `/battle`.
5. Test pratique à deux appareils : choisir 1 minute et 2 joueurs ; rejoindre après le démarrage ; fermer/réouvrir un navigateur pour reprendre ; vérifier les scores et le classement final. Puis tester le compte Premium (2 questions réussies) et confirmer que l'inventaire se conserve après un nouveau match. Tester la Démo pour vérifier qu'elle ne conserve rien dans Supabase.

## Limites et précautions
- Les parties et les tokens temporaires sont dans la mémoire du serveur Render : **redémarrage ou redéploiement = perte des parties en cours**, mais **pas** des équipements Premium déjà enregistrés dans Supabase.
- Les comptes sont contrôlés par la session HttpOnly Academy sur le même domaine ; l'accès Premium dépend de l'abonnement actif. Le mode Démo ne peut pas enregistrer de gains permanents.
- Certains équipements ont un effet passif dès leur acquisition : Laser accélère le tir, Turbo accélère le déplacement, Plasma augmente les dégâts, Bouclier les réduit et Réparation régénère la santé. Radar est pour le moment uniquement une récompense de collection.
- Le jeu Battle est un prototype de jeu éducatif multijoueur : il n'a pas encore été validé sur un parc de téléphones réels, ni soumis à des tests de charge et de sécurité indépendants. Contrôler l'affichage sur Android et PC avant une classe entière.
- Les récompenses sont conservées pour le compte actif, même après défaite, mais le Battle ne fournit pas encore de système avancé d'équipement actif ou de commerce d'objets.
- **Aucun nouveau SQL** pour Snake, Arena ou les quiz existants : seul le Battle Premium nécessite la migration mentionnée.
- Les cours ESP32, Quiz Academy, résultats et certificats existants ne sont pas supprimés ni remplacés.
