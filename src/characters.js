/**
 * Featured stage creatures. Drop matching .glb files in:
 *   public/characters/
 *
 * Optional fields:
 *   look: "void-black" — dark silhouette look (gothic-blue by default; see
 *     ACTIVE_VOID_LOOK_PROFILE in characterFx.js — set "flat-black" to revert)
 *   faceForward: [x,y,z] — local face axis for void-black eye discs
 *   fx: "fire" — looping fire aura attached at runtime (spider)
 *   fallbackFile — tried if `file` is missing
 */
import {
  getCustomCharacterEntries,
  getCustomCharactersCategory,
} from "./customCharacters.js";

export {
  initCustomCharacters,
  isCustomCharacterId,
  getCustomCharacterEntries,
  getCustomCharactersCategory,
} from "./customCharacters.js";

export const characters = [
  {
    id: "shadow-demon",
    name: "Shadow Demon",
    file: "/characters/Shadow_Demon.glb",
    look: "void-black",
    // Tripo mesh faces +Z (toward the head end of the crouch).
    faceForward: [0, 0, 1],
    scale: 1,
    y: 0,
  },
  {
    id: "spider",
    name: "Giant Spider",
    file: "/characters/Giant_Spider.glb",
    fx: "fire",
    scale: 1,
    y: 0,
  },
];

/** Built-in creatures plus user-added GLB models. */
export function getCharacterCatalog() {
  return [...characters, ...getCustomCharacterEntries()];
}

export function getCharacterCategories() {
  return [
    {
      id: "featured",
      name: "Featured",
      characters,
      isCustomCategory: false,
    },
    getCustomCharactersCategory(),
  ];
}

export function getCharacterById(characterId) {
  return (
    getCharacterCatalog().find((character) => character.id === characterId) || null
  );
}

