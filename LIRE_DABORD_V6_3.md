# CFI Academy V6.3 — Cours ESP32 fusionnés + Projects Lab

Prérequis : V6.1 déjà installée (migration 12 questions déjà exécutée). Ne pas réexécuter de migration et ne rien supprimer de Supabase.

## Déploiement
Dans le dépôt GitHub existant, remplacer **ensemble** les cinq fichiers : academy.html, academy-api.js, academy-content.json, academy-bank.json, academy-solutions.json. Commit changes, attendre que Render indique le déploiement réussi, puis ouvrir https://cfi-robot.onrender.com/academy et actualiser. Si nécessaire, terminer ou recommencer un QCM ouvert avant le déploiement. Aucun changement de server.js, Snake, Battle, paiement ou base de données.

## Contenu
- 20 leçons Arduino inchangées, 20 ESP32 avec approfondissements PRO intégrés dans les chapitres correspondants; 26 anciennes leçons accessibles via Archives (identifiants, contenu et banque historiques conservés).
- Deux projets disponibles avec 23 TP cumulatifs : Arduino Feu de circulation (8), ESP32 Smart Home Mini (15). Chaque TP a cahier des charges, plan de connexions logique, programme complet, test et QCM de révision associé (12 questions réutilisées des cours, non pas 276 questions originales). Résultats enregistrés avec nouveaux identifiants. Les 18 autres projets sont des fiches de planification, non accessibles pour l'instant.
- Les anciennes règles de certificat et classement ESP32 PRO restent inchangées; elles ne sont pas transférées aux nouveaux parcours. Les anciennes notes restent intactes, pas d'équivalence automatique de notes. Les jeux continuent à utiliser leur catalogue historique.
- Pull-down, navigation précédent/suivant et recherche conservés. Les pull-up requis par les protocoles I2C/DHT restent distincts. Les schémas des nouveaux TP sont des plans de connexions, pas des photos ni des plans de breadboard physiques. Vérifier la variante ESP32 et les fiches techniques. Servo à alimentation externe adaptée; calibration nécessaire. Les exemples sont des maquettes pédagogiques basse tension.

## Vérifications locales
Syntaxe JavaScript API et navigateur, cohérence des identifiants et banques, conservation des archives et du cursus Arduino, progression à 12/20 et certificat historique, syntaxe Python et C++ (déclarations Arduino simulées). Pas de validation matérielle, navigateur réel, Supabase réel ou déploiement Render.
