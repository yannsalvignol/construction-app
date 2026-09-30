# Avancement par devis — spécification

Pas encore commencé. Ce document existe pour que la décision prise le
24 septembre 2026 ne se reperde pas : ce qu'on construit, pourquoi cette forme
plutôt qu'une autre, et ce qu'on sait déjà des pièges.

## L'idée

Le chef importe le devis d'un chantier (PDF ou photo). L'IA en extrait les
lignes. Les employés déclarent ce qu'ils ont fait — comme aujourd'hui, en
quantités — et le chef voit une barre d'avancement par chantier, par lot et par
jalon, avec un reste à faire chiffré.

C'est la fonctionnalité qui fait passer CASPROD d'un outil de présence à un
outil que le chef paie : la présence dit qui était là, l'avancement dit où en
est l'argent.

## Pourquoi ça s'emboîte avec l'existant

La moitié difficile est déjà faite. `task_declarations` enregistre déjà une
**quantité par code tâche, par chantier, par journée**, avec des unités
(`m`, `m2`, `m3`, `unit`, `kg`). Un devis a exactement la même forme : des
lignes avec une quantité, une unité et un prix.

L'avancement n'est donc pas une nouvelle mécanique, c'est une division :

```
avancement(ligne)  = quantité déclarée / quantité au devis
avancement(jalon)  = Σ (prix × avancement) / Σ prix      ← pondéré par l'argent
reste à faire      = quantité au devis − quantité déclarée
```

Le jalon est pondéré par le prix et non par le nombre de lignes : dix lignes de
robinetterie ne valent pas une chape.

Cela répond directement au constat de l'analyse du planning S37 de Castor :

> « sur 10 semaines de suivi, 5 tâches ne se sont jamais refermées. Le point
> commun n'est pas le chantier ni l'équipe, c'est l'ABSENCE DE RESTE-À-FAIRE
> CHIFFRÉ : tant qu'une tâche est décrite sans quantité restante, elle peut
> être reconduite indéfiniment sans que personne puisse le contester. »

Le devis fournit le dénominateur qui manquait.

## Modèle de données

```
site_quotes      (id, site_id, source_path, parsed_at, status, total_ht)
quote_lines      (id, quote_id, position, label, unit, quantity, unit_price,
                  task_code?, milestone_id?)
quote_subtasks   (id, line_id, position, label, unit, quantity, required)
milestones       (id, quote_id, name, position, amount_or_pct,
                  validated_at, validated_by)
```

Deux choix délibérés, à ne pas « simplifier » plus tard sans y repenser :

- **La ligne garde le libellé d'origine du devis.** Le code catalogue
  (`task_code`) est un lien optionnel, pas un remplacement. Un chef doit
  reconnaître son propre devis à l'écran ; un devis réécrit dans notre
  vocabulaire n'est plus le sien.
- **Un jalon est validé par le chef**, jamais débloqué automatiquement par la
  somme des cases cochées. De l'argent ne bouge pas parce qu'un ouvrier a
  coché.

## L'extraction

Une fonction Edge appelle Claude avec le fichier :

- **PDF** : bloc `document` en base64 (l'API accepte le PDF nativement, jusqu'à
  32 Mo / 600 pages) ;
- **photo** : bloc `image` — une photo d'un devis papier passe par le même
  chemin ;
- **sortie** : `output_config.format` (structured outputs) pour recevoir des
  objets validés plutôt que du texte à reparser ;
- **modèle** : `claude-opus-5`, secret `ANTHROPIC_API_KEY` côté fonction.

**Coût** : un devis de 5 pages ≈ 10k tokens en entrée + 3k en sortie, soit
**0,10 à 0,15 $ par devis**. Ce n'est pas le sujet, même à cent devis par mois.

## Les sous-tâches : des modèles, pas de la génération libre

Une ligne « WC suspendu » cache un bâti-support, une alimentation EF, une
évacuation Ø100, la pose de la cuvette et un essai d'étanchéité. Mais si le
modèle réinvente cette liste à chaque devis, deux chantiers obtiennent deux
découpages différents pour le même travail et plus rien n'est comparable.

Donc : l'IA **propose** le découpage, le chef le corrige **une fois**, et le
résultat est enregistré comme **modèle rattaché au code tâche**. Le devis
suivant qui contient « WC suspendu » réutilise le modèle et ne pose de question
que sur ce qui est nouveau. La qualité monte avec l'usage au lieu de dériver, et
les corrections du chef deviennent un actif.

## Les trois pièges connus

1. **La précision d'extraction dépend énormément du document.** Un PDF tabulaire
   propre est quasiment résolu ; la photo d'un devis annoté à la main, non.
   Conséquence non négociable : un **écran de relecture** où le chef voit chaque
   ligne extraite à côté de la source et corrige les quantités avant
   enregistrement. Ne jamais écrire les lignes parsées directement en base.
2. **Les cases à cocher invitent à l'optimisme.** Un ouvrier qui coche « fait »
   ne ment pas vraiment, il arrondit. Garder les quantités là où l'unité est une
   quantité (18 ml sur 60, pas « terminé »), réserver les cases aux sous-tâches
   réellement binaires, et faire valider le jalon par le chef plutôt que par la
   somme des coches.
3. **Le périmètre est le vrai risque.** Import + jalons + modèles de sous-tâches
   + checklists ouvrier + tableau de bord chef, c'est quatre fonctionnalités.
   Construites d'un bloc, elles sortent dans trois mois et la moitié sera
   fausse.

## Première tranche (deux semaines)

Utile seule, et volontairement incomplète :

- importer un devis (PDF ou photo) sur un chantier ;
- **écran de relecture** : lignes extraites, corrigeables, puis validation ;
- barre d'avancement par chantier et par ligne, calculée à partir des
  déclarations que les employés font **déjà** aujourd'hui ;
- reste à faire chiffré par ligne.

Ni jalons, ni sous-tâches, ni checklists dans cette tranche.

Puis la montrer au chef de Castor avec ses vrais devis. Ses corrections sur
l'écran de relecture diront si les sous-tâches comptent plus que les jalons, ou
l'inverse — pour deux semaines de travail au lieu de trois mois.

## Ensuite (par ordre de valeur présumée, à confirmer par le terrain)

1. Jalons et validation par le chef (c'est ce qui relie l'avancement au paiement).
2. Sous-tâches et modèles par code tâche.
3. Checklists côté employé pour les sous-tâches binaires.
4. Situation de travaux exportable en PDF pour le client / maître d'ouvrage.
