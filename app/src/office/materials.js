// Materiales compartidos por toda la sala: se crean una sola vez.
import * as THREE from 'three';
import { makeKeyboardTexture, makeWoodTexture } from './textures.js';

let cache = null;

export function materials() {
  if (cache) return cache;
  const wood = makeWoodTexture();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  cache = {
    white: std({ color: '#f6f8fb', roughness: 0.5, metalness: 0.02 }),
    gloss: std({ color: '#fbfcfe', roughness: 0.16, metalness: 0.05 }),
    alu: std({ color: '#d3d9e2', roughness: 0.3, metalness: 0.85 }),
    graphite: std({ color: '#1d2531', roughness: 0.42, metalness: 0.45 }),
    navy: std({ color: '#0b1f4b', roughness: 0.45, metalness: 0.25 }),
    oak: std({ map: wood, color: '#ffffff', roughness: 0.62, metalness: 0 }),
    brass: std({ color: '#c9a55c', roughness: 0.26, metalness: 1 }),
    wall: std({ color: '#e9edf3', roughness: 0.9, metalness: 0, side: THREE.BackSide }),
    panel: std({ color: '#dfe5ee', roughness: 0.85, metalness: 0 }),
    glass: std({ color: '#dceaff', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.2, depthWrite: false }),
    lens: std({ color: '#0f1b33', roughness: 0.05, metalness: 0.9 }),
    rubber: std({ color: '#141a23', roughness: 0.85, metalness: 0 }),
    soil: std({ color: '#3b2f27', roughness: 1 }),
    trunk: std({ color: '#7a5a3c', roughness: 0.9 }),
    leaf: [
      std({ color: '#2f7d4f', roughness: 0.75, flatShading: true }),
      std({ color: '#3f9160', roughness: 0.75, flatShading: true }),
      std({ color: '#57a871', roughness: 0.75, flatShading: true }),
    ],
    paper: std({ color: '#ffffff', roughness: 0.9 }),
    keys: std({ map: makeKeyboardTexture(), roughness: 0.55 }),
    ledBlue: new THREE.MeshBasicMaterial({ color: '#93c5fd', toneMapped: false }),
    ledWarm: new THREE.MeshBasicMaterial({ color: '#fff4dc', toneMapped: false }),
    ledRed: new THREE.MeshBasicMaterial({ color: '#f43f5e', toneMapped: false }),
  };
  return cache;
}
