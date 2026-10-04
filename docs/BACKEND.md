# CASPROD — backend présence et productivité

## État de cette livraison

Trois nouvelles migrations locales (`20260907120000`, `20260907130000`, `20260907140000`) remplacent l’API de suivi continu et ajoutent les vérifications ponctuelles, les journées, le catalogue et les déclarations. Les anciennes migrations restent intactes. Aucun changement de cette session n’a été appliqué au projet distant.

Le 7 septembre 2026, l’utilisateur a demandé de concentrer la suite du travail sur le backend, sans vérification d’interface. Le suivi partagé se trouve dans `PROJECT_STATUS.md`.

## Contrats métier

- L’employé accepte explicitement la notice `2026-09-07` via `set_presence_consent`. Chaque accord/retrait crée un événement horodaté non modifiable par le client. Un retrait termine la journée, annule les demandes non réalisées et supprime les adresses push. Il reste possible pour un compte suspendu.
- `start_work_day(declared_site_id, duration_hours)` contrôle le rôle, le compte actif, l’accord courant et le chantier de l’entreprise. Il crée une seule journée par date d’entreprise, empêche les journées simultanées et programme aléatoirement 2 ou 3 demandes dans des fenêtres distinctes. Les demandes futures ne sont accessibles ni dans les sélections directes, ni dans `employee_workspace`, ni par Realtime.
- `end_work_day(day_id)` termine la journée et annule seulement les demandes futures. Une demande déjà échue reste visible comme point à vérifier. Les opérations concurrentes d’un employé prennent les verrous dans le même ordre : profil, journée, demande.
- `submit_presence_check(request, photo, captured, lat, lng, accuracy)` exige une demande en cours, la journée active, un compte actif, l’accord courant, une photo récemment déposée dans le dossier de cette demande et des coordonnées valides. Le chantier et l’employé sont dérivés côté serveur. La photo et l’heure déclarées doivent dater de moins de deux minutes ; une demande ne peut être validée qu’une fois.
- Une preuve confirme un instant déclaré. Elle ne prouve pas une présence continue et les coordonnées fournies par un appareil ne constituent pas un dispositif anti-falsification.
- `declare_task(day_id, code, amount)` accepte uniquement les codes actifs du catalogue. Quantité positive, au plus deux décimales ; nombre entier pour les pièces. Une nouvelle déclaration du même code le même jour remplace le total précédent, évitant les doubles comptes lors d’une nouvelle tentative.
- Le catalogue est organisé en `task_categories` et `task_codes`. La première catégorie plomberie/CVC contient les huit variantes demandées. Lavabo, WC et climatiseur utilisent l’unité ; gaines et réseaux PPR utilisent le mètre. Ajouter un métier/code se fait par une nouvelle migration ; désactiver un code conserve l’historique.
- `chef_dashboard()` compte tous les profils employés de l’entreprise, y compris ceux créés par affiliation. Il renvoie les présences confirmées, les demandes à vérifier, les heures déclarées, les déclarations et les quantités par tâche/unité. Aucun faux chiffre d’absence ou de retard n’est calculé sans planning de référence.
- Un signal de cohérence apparaît si un employé a déclaré le même code, sur le même chantier, avec la même quantité lors de ses trois dernières journées travaillées (les jours sans journée sont ignorés). Il ne bloque jamais une déclaration et disparaît si la quantité varie.

## Accès et conservation

Les tables exposées ont des politiques RLS : un employé voit ses propres journées/déclarations/preuves ; un chef voit celles de son entreprise. Les clients n’écrivent pas directement les preuves, accords ou déclarations : ils passent par les fonctions validées. Les opérations de livraison/nettoyage ne sont exécutables que par `service_role`. Les tokens et reçus push restent dans le schéma non exposé `private`.

Les photos sont dans le bucket privé `presence-proofs`, limité à 5 Mo et aux formats JPEG/PNG. Les accès aux preuves expirent après 30 jours au niveau RLS, même en cas de panne du nettoyage. Le worker efface les fichiers via Storage, puis retire photo/GPS/précision de la ligne ; il conserve le fait qu’une demande a été réalisée. Les fichiers orphelins sont nettoyés après un jour. Les reçus push sont supprimés après un jour, les tokens non renouvelés après 90 jours. Le nettoyage est idempotent et répare une exécution interrompue après suppression du fichier.

Les colonnes historiques de dernier emplacement sont vidées et l’ancienne fonction `update_own_employee_location` est supprimée. Le droit de modifier le commutateur de tracking est retiré et une contrainte SQL empêche sa réactivation ou l’écriture de nouvelles coordonnées continues. La table historique `location_events` est conservée sans accès client ; sa purge éventuelle nécessite une décision de conservation distincte.

## Suppression de compte

`delete_own_account()` (RPC, rôle `authenticated`) supprime le compte de l’appelant et retourne les chemins Storage à effacer ; la fonction Edge `delete-account` l’appelle avec le jeton de l’utilisateur puis efface ces fichiers avec le rôle service. Un employé perd son identifiant, ses données personnelles, ses jetons push, sa position en direct ; ses preuves sont caviardées immédiatement. S’il a déclaré du travail, sa ligne `profiles` subsiste en pierre tombale anonyme (`deleted_at`, nom « Compte supprimé ») pour que journées, déclarations et vérifications gardent leurs clés ; sinon elle est supprimée. Un chef étant seul par entreprise, sa suppression supprime l’entreprise entière, employés compris. Conséquence de schéma : `profiles` ne cascade plus depuis `auth.users` ; `remove_employee` supprime le profil explicitement. Les listes de personnel et le décompte du tableau de bord excluent `deleted_at is not null`.

## Planning

Les créneaux (`planned_shifts` : personne, chantier, date, heures, consigne) sont créés uniquement depuis l’espace web par le chef ; le mobile les lit. Un employé ne voit que ses créneaux **envoyés** (`published_at`), le chef voit tout. `publish_planning(from, to)` marque la période envoyée, journalise dans `planning_sends`, et retourne les personnes concernées ; la fonction Edge `send-planning` l’appelle avec le jeton du chef puis notifie ces personnes via Expo à partir de `planning_push_targets` (rôle service, respecte `notifications_enabled`). Toute modification d’un créneau envoyé efface `published_at` : il redevient invisible jusqu’au prochain envoi. L’ancienne table `shifts` inutilisée est supprimée.

## E-mails transactionnels (Resend)

Par défaut Supabase envoie les e-mails d’authentification depuis son service partagé, limité à quelques messages par heure et souvent classé en indésirable. La récupération de mot de passe en dépend, donc le projet passe par **Resend** en SMTP personnalisé.

**Sous-domaine d’envoi.** `casprod.app` porte déjà les MX de Cloudflare Email Routing (pour `contact@casprod.app`). L’envoi se fait donc depuis `send.casprod.app` : Resend y pose ses propres MX et DKIM sans toucher à la réception sur le domaine racine.

Enregistrements DNS à créer dans Cloudflare (zone `casprod.app`), tels que Resend les affiche après l’ajout du domaine :

| Type | Nom | Valeur | Proxy |
|---|---|---|---|
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` (priorité 10) | DNS only |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | DNS only |
| TXT | `resend._domainkey` | clé DKIM fournie par Resend | DNS only |
| TXT | `_dmarc` | `v=DMARC1; p=none;` (si absent) | DNS only |

Les valeurs exactes (région, clé) viennent du tableau de bord Resend ; ne pas activer le proxy orange, ce sont des enregistrements de messagerie.

**SMTP côté Supabase** (Dashboard → Project Settings → Authentication → SMTP Settings) : hôte `smtp.resend.com`, port `465`, utilisateur `resend`, mot de passe = clé API Resend, expéditeur `no-reply@send.casprod.app`, nom `CASPROD`. Relever ensuite la limite d’envoi (Authentication → Rate Limits), le défaut de 2 e-mails/heure n’ayant plus de raison d’être.

**Modèles.** `supabase/templates/recovery.html` et `confirmation.html` sont les versions françaises à coller dans Authentication → Emails. Elles s’appuient sur `{{ .ConfirmationURL }}` et `{{ .Email }}` ; le lien revient sur `constructionapp://auth/callback`, qui doit rester dans Authentication → URL Configuration → Redirect URLs.

**Limite connue.** Un employé se connecte avec un identifiant traduit en adresse `@employee.local` : aucun e-mail ne lui parvient, et c’est le chef qui réinitialise son mot de passe depuis sa fiche. Les e-mails d’authentification ne concernent donc que les chefs.

## Notifications

`presence-dispatch` doit être invoquée chaque minute. Elle exige un secret dédié dans `Authorization: Bearer …` ; `verify_jwt = false` n’en fait pas une fonction publique sans authentification.

Le serveur réserve les demandes échues avec un verrou et un délai de reprise de cinq minutes. Les notifications ne contiennent que l’identifiant de la demande et un texte générique. Leur durée de vie ne dépasse pas la fenêtre de réponse restante. Les lots sont limités à 100 messages. Les tickets Expo sont conservés puis leurs reçus vérifiés après 15 minutes ; les tokens invalides sont retirés et les erreurs permettent une reprise tant que la demande reste ouverte. Une acceptation par Expo n’est pas une preuve de livraison à l’appareil. L’exécution du nettoyage est indépendante du service push.

## Protection du travailleur isolé

La même invocation minutée porte la surveillance du travailleur isolé, dans une
voie distincte. Le téléphone ne décide plus rien : il signale sa position quand
il bouge (`safety_heartbeat`), et c’est le serveur qui tient l’échéance. Le
silence est le signal — un téléphone posé à côté d’un homme inconscient
n’exécute aucun code, et iOS ne réveille l’application que sur un déplacement,
jamais sur une durée.

Deux étapes, jamais fusionnées. `claim_lone_worker_questions` marque comme
questionnés ceux qui n’ont plus bougé depuis `lone_worker_still_for()` et
renvoie les jetons push disponibles ; l’envoi est au mieux, et un salarié dont
le téléphone refuse les notifications est questionné à l’écran et alerté sur la
même horloge. `raise_due_lone_worker_alerts` est du SQL pur : rien entre le
silence d’un salarié et l’alerte de son chef ne dépend d’un service push en
état de marche. Les chefs sont prévenus une seule fois par alerte.

La surveillance appartient au salarié : `set_lone_worker_watch` n’est appelable
que par lui, aucune RPC chef n’écrit cette colonne, et un chef ne lit pas la
table `lone_worker_watches` — seulement l’alerte, si elle est levée.

## Mise en service, après choix explicite de l’environnement

1. Confirmer la base cible et les migrations appliquées avec `supabase migration list`. Déployer les nouvelles migrations avec `supabase db push`, d’abord dans un environnement de test.
2. Déployer `presence-dispatch` avec `supabase functions deploy presence-dispatch`, `delete-account` et `send-planning` avec `supabase functions deploy delete-account send-planning` (aucun secret supplémentaire ; `EXPO_ACCESS_TOKEN` facultatif comme pour presence-dispatch). Enregistrer un secret aléatoire d’au moins 32 caractères dans `PRESENCE_DISPATCH_SECRET`, à l’aide de `supabase secrets set --env-file <fichier-local-protégé>`. Ne pas commiter ce fichier. Si la sécurité renforcée Expo Push est activée, fournir également `EXPO_ACCESS_TOKEN` côté serveur.
3. Dans Supabase Vault, enregistrer `presence_project_url` (URL du projet) et `presence_dispatch_secret` (même secret). Exécuter `supabase/operations/schedule-presence.sql`. Ce script configure `pg_cron` + `pg_net` et un seul job nommé `casprod-presence-dispatch`.
4. Vérifier les résultats des appels HTTP du job, pas seulement son existence. Une réponse 503 distingue les sous-tâches à reprendre : notifications, reçus, nettoyage. Une erreur d’authentification signifie que Vault et le secret de la fonction ne correspondent pas.
5. Pour la livraison aux téléphones, configurer APNs/FCM sur le projet EAS et produire un nouveau build contenant `expo-notifications`. Vérifier les push sur appareils réels. Aucune notification réelle n’a été envoyée pendant les tests locaux de cette session.

Références techniques consultées : [planification Supabase](https://supabase.com/docs/guides/functions/schedule-functions), [envoi et reçus Expo](https://docs.expo.dev/push-notifications/sending-notifications/), [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).

## Paramètres à confirmer avant production

- Pays et fuseau de référence. Le défaut technique est actuellement `Africa/Casablanca`, cohérent avec l’ancienne carte centrée sur le Maroc ; ce choix n’a pas encore été confirmé par l’utilisateur.
- Journées déclarées de 4, 8 ou 10 heures ; réponse dans les 30 minutes ; conservation photo/GPS de 30 jours. Ce sont des valeurs de cette première implémentation, pas des obligations légales validées.
- Identité et contact du responsable du traitement, finalité/base légale, information et consultation du personnel, exercice des droits, éventuelles formalités/transferts CNDP, conservation des journées/tâches et du journal d’accords. L’accord dans l’application ne remplace pas ces démarches. Références : [CNIL, contrôle de l’activité](https://www.cnil.fr/fr/controle-de-lactivite-des-personnes-employees), [CNDP, délibérations](https://www.cndp.ma/deliberations-1/).

## Vérification locale

`npm test` exécute les migrations et règles applicatives dans PostgreSQL embarqué (PGlite), sans connexion ni modification de la base distante. Le socle Auth/Storage est reproduit ; seuls les anciens champs PostGIS inutilisés sont adaptés au moteur de test. Les tests du worker simulent les réponses d’Expo et Storage. Ils ne valident ni le déploiement Supabase, ni le moteur PostGIS réel, ni APNs/FCM sur appareil.

Le worker est aussi vérifiable sans les types Deno avec `npm run check:backend`.

Résultat de cette session : 21 tests réussis, contrôle TypeScript du worker et lint backend réussis.

## Réglages modifiables sans build

La surveillance du travailleur isolé, les modèles de lecture des devis et les
exigences de photo se coupent et se règlent depuis la base ou les secrets, sans
passer par l'App Store. Voir `docs/OPERATIONS.md`.
