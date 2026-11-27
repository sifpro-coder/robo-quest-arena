# CFI Gaming V7.3 — code universel

Pré-requis: V7.2 (V7.1 serveur, fichiers Academy à conserver). Sauvegarder le dépôt actuel. Dans GitHub, remplacer les 7 fichiers ensemble dans un seul commit: home.html, index.html, snake.html, battle.html, server.js, snake-server.js, battle-server.js. Ne pas remplacer academy.html, academy-api.js, academy-content.json, academy-bank.json, questions.json ou les fichiers SQL. Aucune migration Supabase.

Le champ de code est placé au-dessus du contenu sur l'accueil global et au début des écrans d'accueil des jeux. Un seul code à 6 chiffres (chiffres arabes ou latins acceptés), puis Rejoindre: le serveur identifie Arena, Quiz Live, Snake ou Battle et le navigateur lance automatiquement la demande d'entrée. Les jeux solo ne nécessitent pas de code. Les anciennes invitations spécifiques restent utilisables pour une salle existante; la mise en production redémarre le serveur et les salles en mémoire doivent être recréées. Les salles Premium Battle conservent les contrôles d'abonnement. Les noms existants sont conservés; un pseudo Robot est généré si nécessaire.

Les plages aléatoires sont disjointes: Arena/Quiz 100000–399999, Snake 400000–699999, Battle 700000–999999. Le serveur vérifie la présence effective de la salle. Un code inexistant renvoie une erreur. Cette version suppose une seule instance serveur (salles en mémoire).

Tests locaux: syntaxe de tous les scripts HTML et JS; création des quatre types de salles et résolution du code par HTTP, connexion réelle d'un deuxième client WebSocket pour chaque type; code inconnu et invalide; déclenchement automatique via simulation DOM. Le test navigateur en HTTP local a été bloqué par la politique de Chromium. Tests effectués avec une banque Arena de test et les fichiers Academy locaux; pas de connexion à Supabase de production. Vérifier sur Render avec deux appareils après déploiement. Ne pas lancer de mise à jour pendant une partie.

Les fichiers serveur sont dérivés de V7.1 et des versions Snake/Battle fournies. Si le dépôt a reçu d'autres modifications serveur entre-temps, les fusionner au lieu de les écraser.
