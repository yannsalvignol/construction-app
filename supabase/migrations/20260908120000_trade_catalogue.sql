-- Extends the task catalogue beyond plumbing/HVAC with the standard Moroccan
-- corps d'état (BTP lots). Units are widened first: masonry is measured in m3,
-- coverings and paint in m2, reinforcement steel in kg.
alter table public.task_codes drop constraint task_codes_unit_check;
alter table public.task_codes add constraint task_codes_unit_check
  check (unit in ('unit', 'm', 'm2', 'm3', 'kg'));

-- Plumbing/HVAC stays first so it remains the form's default trade.
insert into public.task_categories (code, label_fr, label_en, sort_order) values
 ('earthworks', 'VRD / Terrassement', 'Earthworks / Utilities', 2),
 ('masonry', 'Gros œuvre / Maçonnerie', 'Structural work / Masonry', 3),
 ('waterproofing', 'Étanchéité / Isolation', 'Waterproofing / Insulation', 4),
 ('electrical', 'Électricité', 'Electrical', 5),
 ('plastering', 'Plâtrerie / Faux-plafonds', 'Plastering / Suspended ceilings', 6),
 ('flooring', 'Revêtements / Carrelage', 'Floor and wall coverings', 7),
 ('carpentry', 'Menuiserie bois', 'Timber joinery', 8),
 ('aluminium', 'Menuiserie aluminium / Vitrerie', 'Aluminium joinery / Glazing', 9),
 ('metalwork', 'Ferronnerie / Métallerie', 'Metalwork', 10),
 ('painting', 'Peinture', 'Painting', 11);

insert into public.task_codes (code, category_code, label_fr, label_en, unit, sort_order) values
 -- Plumbing / HVAC additions (existing codes occupy sort_order 1-8)
 ('SAN_DOUCHE', 'plumbing_hvac', 'Pose receveur de douche', 'Install shower tray', 'unit', 9),
 ('SAN_BAIGNOIRE', 'plumbing_hvac', 'Pose baignoire', 'Install bathtub', 'unit', 10),
 ('SAN_EVIER', 'plumbing_hvac', 'Pose évier', 'Install sink', 'unit', 11),
 ('SAN_ROBINET', 'plumbing_hvac', 'Pose robinetterie', 'Install tap fittings', 'unit', 12),
 ('SAN_CHAUFFE_EAU', 'plumbing_hvac', 'Pose chauffe-eau', 'Install water heater', 'unit', 13),
 ('PLB_PPR_DN20', 'plumbing_hvac', 'Pose réseau PPR DN20', 'Install PPR pipe DN20', 'm', 14),
 ('PLB_PPR_DN40', 'plumbing_hvac', 'Pose réseau PPR DN40', 'Install PPR pipe DN40', 'm', 15),
 ('PLB_PVC_DN40', 'plumbing_hvac', 'Pose évacuation PVC DN40', 'Install PVC waste pipe DN40', 'm', 16),
 ('PLB_PVC_DN100', 'plumbing_hvac', 'Pose évacuation PVC DN100', 'Install PVC waste pipe DN100', 'm', 17),
 ('CVC_GAINE_DN200', 'plumbing_hvac', 'Pose gaine spirale DN200', 'Install spiral duct DN200', 'm', 18),
 ('CVC_CALORIFUGE', 'plumbing_hvac', 'Calorifugeage de gaine', 'Insulate duct', 'm', 19),
 ('CVC_DIFFUSEUR', 'plumbing_hvac', 'Pose diffuseur / grille de soufflage', 'Install air diffuser or grille', 'unit', 20),
 ('CVC_VMC', 'plumbing_hvac', 'Pose VMC / extracteur', 'Install ventilation unit', 'unit', 21),
 ('CVC_RADIATEUR', 'plumbing_hvac', 'Pose radiateur', 'Install radiator', 'unit', 22),

 -- Earthworks / utilities
 ('VRD_DEBLAI', 'earthworks', 'Déblai en pleine masse', 'Bulk excavation', 'm3', 1),
 ('VRD_FOUILLE', 'earthworks', 'Fouille en tranchée', 'Trench excavation', 'm3', 2),
 ('VRD_REMBLAI', 'earthworks', 'Remblai compacté', 'Compacted backfill', 'm3', 3),
 ('VRD_CANA_PVC', 'earthworks', 'Pose canalisation PVC assainissement', 'Install PVC sewer pipe', 'm', 4),
 ('VRD_REGARD', 'earthworks', 'Pose regard de visite', 'Install inspection chamber', 'unit', 5),
 ('VRD_BORDURE', 'earthworks', 'Pose bordure de trottoir', 'Install kerb', 'm', 6),
 ('VRD_PAVE', 'earthworks', 'Pose pavé autobloquant', 'Lay interlocking pavers', 'm2', 7),

 -- Structural work / masonry
 ('GO_COFFRAGE', 'masonry', 'Coffrage', 'Formwork', 'm2', 1),
 ('GO_FERRAILLAGE', 'masonry', 'Façonnage et pose de ferraillage', 'Cut, bend and place reinforcement', 'kg', 2),
 ('GO_BETON_SEMELLE', 'masonry', 'Coulage béton semelles', 'Pour footing concrete', 'm3', 3),
 ('GO_BETON_POTEAU', 'masonry', 'Coulage béton poteaux', 'Pour column concrete', 'm3', 4),
 ('GO_BETON_DALLE', 'masonry', 'Coulage béton dalle / plancher', 'Pour slab concrete', 'm2', 5),
 ('GO_AGGLO_20', 'masonry', 'Maçonnerie agglos 20 cm', 'Blockwork 20 cm', 'm2', 6),
 ('GO_AGGLO_15', 'masonry', 'Maçonnerie agglos 15 cm', 'Blockwork 15 cm', 'm2', 7),
 ('GO_BRIQUE_8', 'masonry', 'Cloison brique 8 trous', '8-hole brick partition', 'm2', 8),
 ('GO_ENDUIT', 'masonry', 'Enduit au mortier', 'Mortar rendering', 'm2', 9),
 ('GO_CHAPE', 'masonry', 'Chape de ravoirage', 'Levelling screed', 'm2', 10),

 -- Waterproofing / insulation
 ('ETA_FORME_PENTE', 'waterproofing', 'Forme de pente', 'Sloping screed', 'm2', 1),
 ('ETA_TERRASSE', 'waterproofing', 'Étanchéité terrasse multicouche', 'Multilayer roof waterproofing', 'm2', 2),
 ('ETA_RELEVE', 'waterproofing', 'Relevé d''étanchéité', 'Waterproofing upstand', 'm', 3),
 ('ETA_SDB', 'waterproofing', 'Étanchéité salle de bain', 'Bathroom waterproofing', 'm2', 4),
 ('ETA_ISOL_THERM', 'waterproofing', 'Pose isolation thermique', 'Install thermal insulation', 'm2', 5),

 -- Electrical
 ('ELE_SAIGNEE', 'electrical', 'Saignée pour encastrement', 'Chasing for flush mounting', 'm', 1),
 ('ELE_GAINE_ICTA', 'electrical', 'Pose gaine ICTA encastrée', 'Install flush ICTA conduit', 'm', 2),
 ('ELE_CABLE_U1000', 'electrical', 'Tirage câble U1000 R2V', 'Pull U1000 R2V cable', 'm', 3),
 ('ELE_POINT_LUM', 'electrical', 'Pose point lumineux', 'Install lighting point', 'unit', 4),
 ('ELE_INTER', 'electrical', 'Pose interrupteur', 'Install switch', 'unit', 5),
 ('ELE_PC_16A', 'electrical', 'Pose prise de courant 16A', 'Install 16A socket outlet', 'unit', 6),
 ('ELE_LUMINAIRE', 'electrical', 'Pose luminaire', 'Install light fitting', 'unit', 7),
 ('ELE_TABLEAU', 'electrical', 'Pose tableau électrique', 'Install distribution board', 'unit', 8),

 -- Plastering / suspended ceilings
 ('PLA_ENDUIT_PLATRE', 'plastering', 'Enduit plâtre lissé', 'Smoothed plaster finish', 'm2', 1),
 ('PLA_PLACO_CLOISON', 'plastering', 'Pose cloison placoplâtre', 'Install plasterboard partition', 'm2', 2),
 ('PLA_FP_PLACO', 'plastering', 'Pose faux-plafond placoplâtre', 'Install plasterboard ceiling', 'm2', 3),
 ('PLA_FP_DEMONT', 'plastering', 'Pose faux-plafond démontable 600x600', 'Install 600x600 demountable ceiling', 'm2', 4),
 ('PLA_STAFF_CORNICHE', 'plastering', 'Pose corniche en staff', 'Install plaster cornice', 'm', 5),
 ('PLA_STAFF_ROSACE', 'plastering', 'Pose rosace en staff', 'Install plaster ceiling rose', 'unit', 6),

 -- Floor and wall coverings
 ('REV_CHAPE_COLLE', 'flooring', 'Application chape de colle', 'Apply adhesive bed', 'm2', 1),
 ('REV_CARR_SOL', 'flooring', 'Pose carrelage sol', 'Lay floor tiles', 'm2', 2),
 ('REV_CARR_MUR', 'flooring', 'Pose faïence murale', 'Lay wall tiles', 'm2', 3),
 ('REV_ZELLIGE', 'flooring', 'Pose zellige', 'Lay zellige tiles', 'm2', 4),
 ('REV_MARBRE_SOL', 'flooring', 'Pose marbre au sol', 'Lay marble flooring', 'm2', 5),
 ('REV_MARCHE', 'flooring', 'Pose marches d''escalier', 'Lay stair treads', 'm', 6),
 ('REV_PLINTHE', 'flooring', 'Pose plinthes', 'Fit skirting', 'm', 7),

 -- Timber joinery
 ('MEN_PORTE_INT', 'carpentry', 'Pose porte intérieure', 'Hang interior door', 'unit', 1),
 ('MEN_PORTE_BLIND', 'carpentry', 'Pose porte blindée', 'Hang armoured door', 'unit', 2),
 ('MEN_PLACARD', 'carpentry', 'Pose placard / dressing', 'Fit built-in wardrobe', 'm2', 3),
 ('MEN_CUISINE', 'carpentry', 'Pose meuble de cuisine', 'Fit kitchen units', 'm', 4),
 ('MEN_HABILLAGE', 'carpentry', 'Habillage bois', 'Timber cladding', 'm2', 5),

 -- Aluminium joinery / glazing
 ('ALU_FENETRE', 'aluminium', 'Pose fenêtre aluminium', 'Install aluminium window', 'm2', 1),
 ('ALU_BAIE_COUL', 'aluminium', 'Pose baie coulissante', 'Install sliding patio door', 'm2', 2),
 ('ALU_PORTE', 'aluminium', 'Pose porte aluminium', 'Install aluminium door', 'unit', 3),
 ('ALU_VITRAGE', 'aluminium', 'Pose vitrage', 'Install glazing', 'm2', 4),
 ('ALU_GARDE_CORPS', 'aluminium', 'Pose garde-corps aluminium', 'Install aluminium balustrade', 'm', 5),
 ('ALU_MOUST', 'aluminium', 'Pose moustiquaire', 'Install insect screen', 'm2', 6),

 -- Metalwork
 ('FER_CHARPENTE', 'metalwork', 'Montage charpente métallique', 'Erect steel structure', 'kg', 1),
 ('FER_PORTAIL', 'metalwork', 'Pose portail métallique', 'Install metal gate', 'unit', 2),
 ('FER_PORTE_METAL', 'metalwork', 'Pose porte métallique', 'Install metal door', 'unit', 3),
 ('FER_GRILLE', 'metalwork', 'Pose grille de protection', 'Install security grille', 'm2', 4),
 ('FER_RAMPE', 'metalwork', 'Pose rampe d''escalier', 'Install stair railing', 'm', 5),

 -- Painting
 ('PEI_ENDUIT_LISS', 'painting', 'Enduit de lissage', 'Skim coat', 'm2', 1),
 ('PEI_IMPRESSION', 'painting', 'Couche d''impression', 'Primer coat', 'm2', 2),
 ('PEI_MUR_INT', 'painting', 'Peinture murs intérieurs', 'Paint interior walls', 'm2', 3),
 ('PEI_PLAFOND', 'painting', 'Peinture plafond', 'Paint ceiling', 'm2', 4),
 ('PEI_FACADE', 'painting', 'Peinture façade extérieure', 'Paint exterior facade', 'm2', 5),
 ('PEI_BOISERIE', 'painting', 'Peinture boiseries', 'Paint timber joinery', 'm2', 6),
 ('PEI_FER', 'painting', 'Peinture antirouille sur métal', 'Anti-rust paint on metal', 'm2', 7);
