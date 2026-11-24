# CFI Academy V5 — abonnement mensuel 10 DT + progression verrouillée

## Ce qui change

- Prix de lancement : **10 DT / mois = 10 000 millimes** (pas 50 DT par cours).
- Chaque paiement **vérifié côté serveur** donne un mois calendaire d'accès ; **aucun prélèvement bancaire automatique** n'est lancé.
- Le professeur/Admin peut modifier le tarif à tout moment dans `Academy → Admin → Prix mensuel`. Cela concerne les paiements à venir, pas les anciennes transactions.
- L'Admin peut approuver ou prolonger manuellement l'accès d'un élève d'un mois (bouton « ➕ شهر »).
- Après expiration, les cours et les soumissions sont bloqués ; le compte peut toujours consulter **ses propres anciens résultats** et effectuer un renouvellement.
- **Level 2** reste verrouillé jusqu'à ce que toutes les **10 unités du Level 1** (3 leçons + 7 TP) soient validées. Sur chaque unité : réponse à **toutes** les questions, score au moins **12/20** ; les TP demandent aussi le code de l'élève. Level 2 comporte 12 unités.
- Les questions et leur validation sont contrôlées **sur le serveur**, pas seulement par des boutons désactivés dans la page.
- Les **10 joueurs** du mode Arena existant sont conservés.

## ÉTAPE 1 — Supabase (créé, mais SQL pas encore exécuté)

Dans le projet `cfi-academy` sur https://supabase.com/dashboard :
`SQL Editor → New query` et copier-coller le contenu de **CFI_SUPABASE_FRESH_V5.sql**. Cliquer `Run` **une seule fois**. Ce fichier inclut la structure V3, la migration V4 et la migration V5 dans le bon ordre.

**Si les tables de V4 existent déjà**, ne pas relancer le SQL complet. Copier-coller uniquement **schema_v5_monthly.sql**. Pour une base V3, appliquer `schema_v4_migration.sql` puis `schema_v5_monthly.sql`.

Ne jamais partager ni publier le mot de passe de la base, la clé service_role ou `sb_secret_...`.

## ÉTAPE 2 — GitHub

1. Décompresser le ZIP dans le téléphone.
2. Ouvrir https://github.com/sifpro-coder/robo-quest-arena/upload/main .
3. Envoyer les fichiers du projet **à la racine** du dépôt (pas le ZIP). Le fichier SQL peut rester local et ne doit pas être exécuté par Render.
4. Cliquer `Commit changes`. Conserver le projet GitHub actuel, ne pas en créer un nouveau.

## ÉTAPE 3 — Render

Garder le même Web Service et les variables de configuration de V4 :

- `SUPABASE_URL` : URL du projet Supabase.
- `SUPABASE_SECRET_KEY` : clé secrète serveur, **Render Environment uniquement**.
- `SESSION_SECRET` : longue chaîne aléatoire (min. 32 caractères).
- `ADMIN_USERNAME`, `ADMIN_PASSWORD` : le compte de l'unique professeur.
- `CFI_PUBLIC_URL` : URL HTTPS réelle du service Render, sans `/academy`.
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` : pour les emails de confirmation via HTTPS API.
- `KONNECT_API_KEY`, `KONNECT_WALLET_ID` et `KONNECT_MODE=sandbox` : optionnel, pour **tester** le paiement ; ne passer en live qu'après validation officielle.

**La V5 ne dépend plus de `CFI_PRICE_MILLIMES`** : le prix est maintenant enregistré dans `cfi_settings` (10 000 millimes par défaut) et modifiable dans le tableau Admin.

Vérifier les logs Render puis visiter **votre domaine Render actuel** suivi de `/academy`. Ne supposer aucune URL nouvelle tant que Render ne l'a pas affichée.

## ÉTAPE 4 — Recette avant d'inscrire les élèves

- Test professeur : connexion, vue Admin, modifier le prix, prolonger un élève d'un mois.
- Test élève : vérifier l'email du parent, attendre approbation professeur ou paiement confirmé.
- Tester qu'une réponse QCM incomplète est refusée.
- Tester que Level 2 reste fermé jusqu'à validation des 10 unités du Level 1.
- Tester l'expiration du mois sur un compte de démonstration (sans supprimer les notes).
- Tester les paiements **uniquement en Sandbox Konnect** avant les encaissements réels.

**Attention** : GitHub Public expose les questions/réponses stockées en JSON. Avant de faire des évaluations notées réelles, passer le dépôt en Private (avec Render toujours autorisé) ou déplacer les corrigés dans une base protégée.

Le test automatisé local a simulé l'authentification, le niveau verrouillé, la correction, les prolongations et les confirmations Konnect ; cela ne remplace pas un test réel avec Supabase, Brevo et Konnect.
