'use strict';

const OWNERS = {
  L: { code: 'L', name: 'Lucas',  label: 'LUCAS'  },
  S: { code: 'S', name: 'Solène', label: 'SOLENE' },
  M: { code: 'M', name: 'Mixte',  label: 'MIXTE'  }
};

// Les "sigles" imprimables sur l'étiquette.
const TAGS = [
  { id: 'fragile',   label: 'FRAGILE',        short: 'FRAGILE',  icon: 'glass',  emoji: '🍷' },
  { id: 'lourd',     label: 'Lourd',          short: 'LOURD',    icon: 'weight', emoji: '🏋️' },
  { id: 'haut',      label: 'Ce côté en haut',short: 'HAUT ↑',   icon: 'up',     emoji: '⬆️' },
  { id: 'nempile',   label: 'Ne pas empiler', short: 'NE PAS EMPILER', icon: 'nostack', emoji: '🚫' },
  { id: 'urgent',    label: 'Ouvrir en 1er',  short: 'OUVRIR 1er', icon: 'star', emoji: '⭐' },
  { id: 'liquide',   label: 'Liquides',       short: 'LIQUIDE',  icon: 'drop',   emoji: '💧' },
  { id: 'precieux',  label: 'Précieux',       short: 'PRECIEUX', icon: 'star',   emoji: '💎' }
];

const STATUSES = [
  { id: 'open',     label: 'En cours',  hint: 'Carton ouvert, on remplit encore' },
  { id: 'closed',   label: 'Fermé',     hint: 'Scotché et étiqueté' },
  { id: 'loaded',   label: 'Chargé',    hint: 'Dans le camion' },
  { id: 'arrived',  label: 'Arrivé',    hint: 'Déposé dans la pièce de destination' },
  { id: 'unpacked', label: 'Déballé',   hint: 'Vidé, terminé' }
];

const KINDS = [
  { id: 'box',  label: 'Carton' },
  { id: 'item', label: 'Objet / meuble' }
];

/**
 * Les deux formats d'etiquette. Chacun a son imprimante, son format pilote et ses
 * reglages : le rouleau continu (Brother QL-700, rouleau 50 mm) pour les petites
 * etiquettes des cotes du carton, et l'etiquette d'expedition predecoupee 4x6 pouces
 * (101,6 x 152,4 mm) pour la grande, lisible de loin.
 *
 * La largeur n'est pas dans le libelle : elle se regle dans l'ecran Reglages, et un
 * nom fige a « 62 mm » mentirait des qu'on change de rouleau.
 */
const LABEL_FORMATS = [
  {
    id: 'roll',
    label: 'Rouleau continu',
    short: 'rouleau',
    hint: 'Bande continue coupée à la longueur voulue (QL-700) : les petites étiquettes des côtés du carton. La longueur suit la hauteur des faces.',
    modes: [
      { id: 'fold',   label: '2 faces dans le même sens — bande à plier sur l’arête' },
      { id: 'mirror', label: '2 faces tête-bêche — à découper et coller séparément' },
      { id: 'single', label: '1 seule face' }
    ]
  },
  {
    id: 'shipping',
    label: 'Étiquette 4×6 pouces',
    short: '4×6',
    hint: 'Grande étiquette d’expédition prédécoupée (101 × 152 mm) : lisible de loin, et le détail du contenu tient dessus.',
    modes: [
      { id: 'single', label: '1 grande face sur toute l’étiquette' },
      { id: 'fold',   label: '2 demi-faces dans le même sens — à plier sur l’arête' },
      { id: 'cut',    label: '2 demi-faces à découper en deux étiquettes' }
    ]
  }
];

const LABEL_FORMAT_IDS = LABEL_FORMATS.map(f => f.id);

module.exports = { OWNERS, TAGS, STATUSES, KINDS, LABEL_FORMATS, LABEL_FORMAT_IDS };
