# CASPROD — suivi du projet

Mis à jour le 7 septembre 2026. Lire ce fichier au début des prochaines sessions.
Les instructions Expo restent dans `AGENTS.md` ; les migrations SQL décrivent le schéma.

## Demandes en cours

- Remplacer le suivi GPS continu par 2–3 vérifications ponctuelles aléatoires par journée déclarée : photo prise sur place, position actuelle, chantier déclaré.
- Information obligatoire et accord explicite, versionné, avant toute activation. Aucun accès caméra/GPS avant une action de l’utilisateur.
- Déclarations par codes de tâches, avec catégories extensibles ; première catégorie plomberie/CVC. Aucun texte libre pour décrire une tâche.
- Accueil chef plus simple, effectif réel incluant les affiliations, présence et productivité lisibles.
- Signal léger après trois journées travaillées consécutives avec même tâche, chantier et quantité. Indicateur uniquement, jamais un blocage ou une accusation.
- Palette violet/blanc, vrais fonds et contrastes sombres sur tous les écrans.
- Clavier de connexion : passage identifiant → mot de passe, fermeture à la validation et à la connexion.

## Choix de cette itération

- Les contrôles sont planifiés côté serveur ; les demandes futures ne sont pas lisibles par les employés. Notifications push à l’échéance, photo/GPS uniquement après appui volontaire.
- Fenêtre de réponse : 30 minutes. Une demande sans réponse reste « à vérifier », sans déduire automatiquement une absence.
- Une journée est rattachée à un chantier, avec une durée annoncée et une fin explicite ; les heures sont des heures déclarées, pas une preuve de présence continue.
- Le catalogue et les déclarations sont persistés dans Supabase ; les quantités restent séparées par tâche et unité.
- Pays/plage horaire demandés à l’utilisateur ; ne pas présenter des valeurs par défaut comme une décision validée.
- La notice dans l’app ne vaut pas validation juridique de l’employeur. À préciser avant production : responsable/contact, base légale, information/consultation du personnel, formalités CNDP éventuelles, transferts et conservation. Sources : https://www.cnil.fr/fr/controle-de-lactivite-des-personnes-employees et https://www.cndp.ma/deliberations-1/.

## Avancement

12 septembre 2026 — préparation App Store : suppression de compte en libre-service (migration `20260912100000`, fonction Edge `delete-account`, section « Supprimer le compte » de l’écran Compte, tests), liens externes politique/CGU via `EXPO_PUBLIC_PRIVACY_POLICY_URL` / `EXPO_PUBLIC_TERMS_URL` (repli sur la notice intégrée), clé Google Maps Android injectée par `app.config.js` depuis `GOOGLE_MAPS_ANDROID_API_KEY`. Notes de review, étiquette confidentialité et liste des actions manuelles dans `docs/APP_STORE_SUBMISSION.md` ; brouillons de politique de confidentialité et de CGU dans `docs/legal/`. Rien de tout cela n’est déployé sur le projet distant.


L’utilisateur a demandé de rester sur le backend et de ne pas vérifier l’interface. Aucune autre vérification ou modification visuelle à entreprendre sans nouvelle demande. Les modifications d’interface déjà écrites restent présentes ; leur validation visuelle n’a pas été effectuée.

Backend implémenté localement :

- Trois migrations nouvelles : présence/consentement/catalogue ; indicateurs et livraison ; données de la journée employé.
- Ancienne API GPS supprimée ; ancien suivi désactivé avec une contrainte SQL empêchant sa réactivation.
- Accord obligatoire et événements d’accord/retrait non modifiables par le client.
- Demandes aléatoires cachées, preuves privées, validation serveur, protection entre entreprises.
- Catalogue des huit variantes plomberie/CVC, quantités par unité, sauvegarde sans double compte, signal de répétition.
- Fonction `presence-dispatch` avec réservation/reprise, tickets et reçus Expo, suppression des tokens invalides et nettoyage indépendant des pannes push.
- Accès photo/GPS coupé après 30 jours ; suppression des fichiers puis retrait des coordonnées, en conservant l’enregistrement de réalisation de la demande.
- `npm test` : 21 tests réussis. `npm run check:backend` : TypeScript du worker et lint backend réussis. PostgreSQL embarqué pour les règles, réponses Expo/Storage simulées pour le worker ; pas de validation d’un déploiement distant ni d’un téléphone réel.

À mettre en service après choix explicite de l’environnement : migrations, secrets de fonction/Vault, worker, job Cron, configuration APNs/FCM et nouveau build mobile. Aucun changement appliqué à la base distante et aucune notification réelle envoyée.

Voir `docs/BACKEND.md` pour les contrats RPC, les règles, la procédure et les limites de validation. Voir `supabase/operations/schedule-presence.sql` pour le job planifié.

Paramètres encore à confirmer : pays/fuseau (défaut provisoire `Africa/Casablanca`), durées proposées 4/8/10 h, fenêtre de réponse 30 min, conservation des preuves 30 jours et informations employeur de la notice. Ne pas les présenter comme validés juridiquement ou confirmés par l’utilisateur.

## État initial à préserver

La session commence avec des modifications non commitées sur l’authentification, les traductions, les formulaires et le stockage SQLite/web. Ne pas les annuler.
Ne pas modifier les anciennes migrations déjà potentiellement déployées. Ne pas appliquer automatiquement de changements à la base distante.
