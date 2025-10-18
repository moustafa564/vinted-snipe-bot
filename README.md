# vinted-sniper

Script Node.js qui surveille des recherches Vinted, filtre par marque/prix/qualité, et envoie des alertes Discord (embed + photo).

## Fichiers inclus
- index.js
- package.json
- config.json.example
- TERMS.md
- LICENSE.txt

## Installation (Replit)
1. Importez ce repo sur Replit (Import from GitHub).
2. Dans Replit → Secrets (icône clé) : ajoutez `DISCORD_WEBHOOK` = votre webhook Discord.
3. Copiez `config.json.example` → `config.json` et ajustez `searches`.
4. Ouvrez le Shell et lancez :
   ```bash
   npm install
   npm start
