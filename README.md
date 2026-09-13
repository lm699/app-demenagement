# 📦 Déménagement — inventaire des cartons + étiquettes

Application locale (PC + mobile) pour créer des cartons, dire ce qu'il y a dedans,
prendre des photos, et imprimer leurs étiquettes code-barres. Fermer un carton
imprime un **kit** : une grande étiquette d'expédition 4 × 6 pouces pour la face
avant, plus trois petites bandes du rouleau continu 50 mm (Brother QL-700) pour les
autres côtés — empilé, un carton ne montre jamais la face qu'on voudrait lire.

Aucune donnée ne sort du PC : tout est dans `data/` (SQLite + photos).

---

## Démarrer

Double-clic sur **`Demarrer.bat`** — ou en ligne de commande :

```bash
npm start
```

Le serveur affiche les adresses :

```
PC       : http://localhost:3000
Mobile   : http://192.168.1.12:3000
Scan live: https://192.168.1.12:3443
```

### Sur le téléphone

1. Même Wi-Fi que le PC.
2. Ouvrir `http://<ip-du-pc>:3000` (le QR code est dans **Réglages**).
3. Menu du navigateur → **Ajouter à l'écran d'accueil** : l'app s'installe comme une vraie app (PWA).

Le mobile et le PC voient la même base en temps réel. Un carton fermé depuis le
téléphone déclenche immédiatement l'impression sur l'imprimante branchée au PC.

---

## Les deux formats d'étiquette

Chaque format a **sa propre imprimante**, son format pilote, ses dimensions et ses
recalages : les deux restent branchés en permanence, rien à reconfigurer pour passer
de l'un à l'autre.

| Format | Support | Pour quoi faire |
|---|---|---|
| **Rouleau continu 50 mm** | rouleau 50 mm × 30 m à couper (Brother QL-700) | les **petites** étiquettes, une par côté du carton |
| **Étiquette 4 × 6** | étiquette d'expédition prédécoupée 101,6 × 152,4 mm | la **grande** étiquette, lisible de loin, avec le détail du contenu listé dessus |

À la fermeture d'un carton, les deux partent ensemble : c'est le kit décrit plus bas.
*Réglages → Impression → Format utilisé par défaut* ne sert qu'aux étiquettes lancées
à l'unité — depuis la fiche d'un carton, ou à la fermeture si le kit est décoché. La
fiche d'un carton a un sélecteur **Format d'étiquette** : la même étiquette peut être
relancée dans l'autre format sans rien changer aux réglages. Chaque impression garde
le format demandé, même si le défaut change entre temps pendant qu'elle est en file.

---

## Le kit d'un carton

Fermer un carton met en file **une étiquette par côté**, la grande en premier :

| | Format | Où ça se colle |
|---|---|---|
| 1 × | 4 × 6 pouces | la face avant : code, destination et contenu listé, lisible à trois mètres |
| 3 × | rouleau 50 mm | les autres côtés, pour retrouver le carton sans le tourner |

Le nombre de petites se règle dans *Réglages → Kit d'étiquettes* (0 à 6). En
disposition `fold` ou `mirror`, **une bande porte deux faces** : trois bandes couvrent
donc six côtés. L'écran de réglages affiche en clair ce que chaque fermeture enverra,
et sur quelle imprimante.

Un job par étiquette, pas un job pour le kit : si le ruban se bloque à la deuxième
bande, *Réessayer* ne relance que celle-là. Décocher **Imprimer le kit complet**
revient au comportement d'avant : une seule étiquette, dans le format par défaut.

---

## Les petites étiquettes — rouleau 50 mm

Bande de **50 × 88 mm** contenant **deux faces identiques** (38 mm chacune) séparées
par une **zone blanche de 12 mm** qui se pose sur l'arête du carton.

Chaque face porte :

| Zone | Contenu |
|---|---|
| En-tête | Code géant `L-042` + pastille propriétaire (LUCAS / SOLENE / MIXTE) et type (CARTON / OBJET) |
| Contenu | Description, plus le détail des objets si la description tient sur une ligne |
| Destination | Bandeau noir pleine largeur, lisible de loin |
| Sigles | FRAGILE (en inverse), HAUT ↑, LOURD, NE PAS EMPILER, OUVRIR 1er, LIQUIDE, PRECIEUX |
| Code-barres | Code128 du code carton + code en clair dessous |

Le préfixe du code indique le propriétaire : **L**ucas, **S**olène, **M**ixte.
La numérotation est indépendante par propriétaire (`L-001`, `S-001`, `M-001`…).

### Les deux faces : pourquoi le même sens

Le mode par défaut est **`fold`** : la bande n'est pas coupée.

```
   ┌──────────────┐  ← la moitié haute retombe sur le DESSUS du carton
   │   face 1     │     38 mm
   ├──────────────┤
   │  zone blanche│     12 mm — se pose sur l'arête
   ├──────────────┤
   │   face 2     │     38 mm
   └──────────────┘  ← la moitié basse reste sur la FACE LATÉRALE
```

La zone blanche est volontairement vide : rien d'imprimé ne tombe dans le pli, et
surtout on n'a pas besoin de viser l'arête au millimètre. Le pli est repéré par deux
amorces sur les bords gauche et droit, le centre reste vierge. Élargis-la dans les
réglages si tes cartons ont des arêtes épaisses ou des rabats qui dépassent.

Quand on plie une bande sur l'arête d'un carton, la partie qui bascule sur le dessus
se retrouve automatiquement à l'endroit pour quelqu'un qui regarde le carton de face.
Imprimer la seconde face à 180° la rendrait illisible dans cette configuration.

Résultat : **une étiquette lisible sur le dessus, une sur le côté** — donc lisible
même quand les cartons sont empilés, ce qui est le but.

Si tu préfères découper et coller les deux étiquettes séparément, passe en
**`mirror`** (tête-bêche) dans *Réglages → Rouleau continu → Disposition* : une bande
donne alors deux petites étiquettes indépendantes, une par côté.

---

## La grande étiquette 4 × 6 pouces

**101,6 × 152,4 mm** sur une imprimante d'expédition. Contrairement au rouleau, la
taille est imposée par l'étiquette prédécoupée : ce sont les faces qui se partagent
la hauteur, jamais l'inverse.

L'étiquette reprend les mêmes zones que la petite, dans un ordre adapté à la surface
disponible :

| Zone | Ce qui change par rapport au rouleau |
|---|---|
| En-tête | Code géant + pastille propriétaire / type, identique |
| Destination | Remonte **juste sous le code** : c'est ce qu'on lit en premier à trois mètres |
| Contenu | Description sur une ou deux lignes |
| Détail | **Le contenu listé ligne par ligne** (« • Assiettes plates »), avec « + N autres » si ça déborde — impossible sur une face de 38 mm |
| Sigles | Même rangée de pastilles, en plus gros |
| Code-barres | Même Code128, sur ~30 mm de haut |

Trois dispositions (*Réglages → Étiquette 4×6 → Disposition*) :

| Disposition | Ce que ça donne |
|---|---|
| `single` (défaut) | 1 grande face sur toute l'étiquette |
| `fold` | 2 demi-faces dans le même sens, séparées par la zone blanche — même logique de pli que le rouleau, mais sur une étiquette prédécoupée |
| `cut` | 2 demi-faces à découper : deux étiquettes de 101 × 76 mm par impression |

En `fold`, la zone blanche est **prise sur** les 152,4 mm (elle ne peut pas allonger
une étiquette prédécoupée) : chaque face fait `(152,4 − pli) / 2`.

---

## Écrans

| Écran | À quoi ça sert |
|---|---|
| **Accueil** | Compteurs par statut, cartons en cours, répartition par destination |
| **Nouveau** | Création en une seule page : type, propriétaire, contenu, destination, sigles, photos. Le bouton de fermeture annonce le kit qu'il va imprimer |
| **Scanner** | Caméra en direct, photo du code-barres, ou saisie manuelle du code |
| **Cartons** | Recherche plein texte (code, contenu, objet listé, pièce) + filtres |
| **Étiquettes** | File d'impression (avec le format de chacune), réimpression, aperçu, export CSV / JSON |
| **Réglages** | Le kit imprimé à la fermeture, une carte par format d'étiquette (imprimante, format pilote, dimensions, aperçu), destinations, raccourcis de contenu (perso / mixte), QR d'accès mobile |

### Raccourcis de contenu

Sous le champ *Contenu*, une rangée de raccourcis évite de tout retaper. Elle
**change avec le propriétaire** choisi juste au-dessus :

| Propriétaire | Ce qui est proposé |
|---|---|
| Lucas, Solène | Affaires personnelles — Habits, Chaussures, Manteaux, Affaires de sport, Bijoux, Cosmétiques, Papiers personnels, Ordinateur… |
| Mixte | Objets communs du foyer — Vaisselle, Verres, Casseroles & poêles, Produits ménagers, Linge de maison, Déco, Outils & bricolage… |

Un carton d'habits n'a rien à voir avec un carton de vaisselle : séparer les deux
listes évite de faire défiler des raccourcis qui ne servent jamais pour ce carton-là.
Cliquer plusieurs raccourcis les cumule (« Habits, Chaussures »). Les deux listes
s'éditent dans *Réglages → Raccourcis de contenu*.

### Objets hors carton

Le sélecteur **Carton / Objet** en haut de l'écran de création sert aux meubles,
vélos, plantes et tout ce qui ne rentre pas dans un carton. Même code, même étiquette,
même recherche — l'étiquette indique `OBJET` au lieu de `CARTON`.

---

## Scanner un code-barres

| Situation | Ce qui marche |
|---|---|
| `http://<ip>:3000` sur mobile | Photo du code-barres (décodée dans l'app) + saisie manuelle |
| `https://<ip>:3443` sur mobile | Caméra en direct, scan continu |
| PC avec douchette USB | La douchette tape le code : le champ « saisir le code » suffit |

La caméra en direct exige une connexion sécurisée (règle des navigateurs). Le serveur
génère donc un certificat auto-signé au premier démarrage : il faut accepter
l'avertissement du navigateur une seule fois par appareil.

Ce certificat n'est refait que s'il ne couvre plus une des IP de la machine — sinon
chaque redémarrage obligerait à réaccepter l'avertissement partout. **Si le certificat
change quand même** (nouvelle IP, machine changée de box), un téléphone qui avait
accepté l'ancien peut couper la connexion sans rien demander :

| Symptôme sur le téléphone | Ce que ça veut dire |
|---|---|
| « La connexion réseau a été perdue » sur `:3443`, alors que la navigation privée passe | Exception de certificat périmée : effacer les données de site dans les réglages du navigateur, puis redémarrer le téléphone |
| L'app s'ouvre mais affiche « Impossible de joindre le serveur » | Coquille servie par le cache : le bouton *Vider le cache de l'app et recharger* de cet écran suffit |

Dans les deux cas, `http://<ip>:3000` continue de marcher : pas de certificat, pas de
cache hors-ligne, tout est identique **sauf** le scan caméra en direct. C'est
l'adresse à mettre sur l'écran d'accueil si on ne se sert pas de la caméra en direct.

---

## Réglages d'impression

L'écran *Réglages* a **une carte par format** : imprimante, format pilote,
disposition, dimensions, recalages et aperçu en direct, chacun de son côté. Les deux
formats ne partagent que la résolution de rendu et la case « imprimer à la fermeture ».

- **Kit d'étiquettes** — combien de petites bandes partent avec la grande à chaque
  fermeture (0 à 6, 3 par défaut), et la possibilité de revenir à une étiquette
  unique. Le récapitulatif dessous liste ce qui sera envoyé et sur quelle imprimante :
  c'est là qu'on voit qu'il en manque une, pas devant le carton déjà scotché.

- **Imprimante** — liste réelle des imprimantes Windows. Laisser vide = mode aperçu,
  l'étiquette est générée en PNG sans rien imprimer (utile pour tester). Les deux
  cartes peuvent viser la même imprimante si elle sait faire les deux supports.
- **Format du pilote** — laisser sur *détection automatique* : le programme retient
  le format **le plus court qui contienne réellement l'étiquette**, à la bonne largeur.
  L'écran de réglages affiche en direct celui qui sera utilisé (pour une 4 × 6, c'est
  typiquement le format `4 x 6` du pilote, imprimé au 1:1).
- **Hauteur d'une face** (38 mm) et **Zone blanche au pli** (12 mm) — *rouleau
  uniquement* : les deux déterminent la longueur de la bande. Le pilote QL-700
  n'accepte que des longueurs discrètes, et pour un rouleau **50 mm il n'en propose
  qu'une** :

  | Largeur du rouleau | Longueur de bande | Format pilote retenu |
  |---|---|---|
  | 50 mm | ≤ **89,9 mm** | `50mm` ← réglage actuel (88 mm) |
  | 62 mm | ≤ 89,9 mm | `62mm` |
  | 62 mm | ≤ 99,8 mm | `62mm x 100mm` |
  | 62 mm | ≤ 183,9 mm | `Etiquette d'affranchissement 62mmx184mm` |

  Sur du 50 mm, `face × 2 + pli` doit donc rester sous 89,9 mm : 38 + 38 + 12 = 88 mm
  passe, 43 + 43 + 12 = 98 mm ne passe pas. Dépasser fait passer au palier suivant
  quand il existe, et gaspille du ruban ; l'écran de réglages le signale (« X mm de
  ruban en trop »). Si la bande dépasse le plus grand format, l'impression est refusée
  avec un message explicite plutôt que rognée silencieusement.

  Les valeurs numériques sont bornées côté serveur : une saisie aberrante est
  rejetée au lieu de casser toutes les impressions suivantes. Les listes fermées
  (format, disposition) le sont aussi : une valeur inconnue est refusée au lieu de
  retomber silencieusement sur le défaut.

- **Largeur / hauteur de l'étiquette** — *4 × 6 uniquement* : la taille du support
  prédécoupé (101,6 × 152,4 mm pour du 4 × 6 pouces). À changer seulement si tes
  planches font une autre taille.

- **Recalage horizontal / vertical** — à ne toucher que si l'impression est décalée
  sur le support. Positif = vers la droite / vers le bas. Chaque format a le sien :
  régler la QL-700 ne dérègle pas l'imprimante 4 × 6.

### Zone imprimable : pourquoi l'étiquette est plus petite que le ruban

La tête thermique n'imprime pas jusqu'au bord de la bande. Sur un rouleau 50 mm,
le pilote QL-700 déclare une zone imprimable de **46,91 mm** de large, décalée de
1,5 mm depuis le bord gauche (et 3 mm depuis le haut) :

```
|<--------------- page 50,0 mm --------------->|
| 1,5 |<------ imprimable 46,91 mm ------>| 1,6 |
```

Le programme interroge le pilote, récupère cette zone, puis **dessine l'étiquette
exactement à cette taille**. L'image part donc à l'imprimante au 1:1, sans
rééchantillonnage — c'est ce qui garde les barres du code-barres nettes.

Conséquence : une bande demandée à 50 × 88 mm sort à **46,9 × 82,6 mm** (94 %).
L'écran de réglages affiche systématiquement la taille réellement imprimée.

La même règle s'applique à la 4 × 6, mais les imprimantes d'expédition déclarent en
général une zone imprimable **plus large que l'étiquette** : rien n'est réduit, la
101,6 × 152,4 mm sort au 1:1.

- **Impression automatique à la fermeture** — décocher pour empiler les étiquettes
  et les lancer par lot depuis l'écran *Étiquettes*.

Si l'imprimante est éteinte ou le rouleau bloqué, le job passe en **erreur** dans la
file avec le message du pilote, et le bouton *Réessayer* le relance. Rien n'est perdu.
La file affiche le format de chaque étiquette (`rouleau` / `4×6`) et l'imprimante qui
l'a prise — les quatre lignes d'un même kit portent le même code de carton.

---

## Sauvegarde

Tout est dans le dossier `data/` :

```
data/demenagement.db   base SQLite
data/photos/           photos + miniatures
data/labels/           derniers PNG d'étiquettes générés
data/cert.json         certificat HTTPS auto-signé
```

Copier ce dossier suffit à tout sauvegarder. Les exports **CSV** et **JSON** sont
disponibles en bas de l'écran *Étiquettes* (le CSV s'ouvre directement dans Excel).

---

## Détails techniques

- **Node ≥ 22**, base via le module intégré `node:sqlite` — aucun serveur à installer.
- Étiquettes dessinées avec `@napi-rs/canvas`, code-barres par `bwip-js`, rendu à
  300 dpi avec un facteur d'échelle **entier** sur les modules du code-barres pour
  que toutes les barres fassent exactement la même largeur (scan fiable).
- Impression via `System.Drawing.Printing` (script `server/print-image.ps1`) :
  pas de driver tiers, pas de dépendance native. Le script sait aussi lister les
  imprimantes (`-ListPrinters`), leurs formats (`-ListPapers`) et simuler une
  impression (`-DryRun`).
- Temps réel PC ↔ mobile par Server-Sent Events.
