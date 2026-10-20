# Politiek in Perspectief

Een rustige, openbare Nederlandstalige site met wekelijkse politieke context.

## Publiceren via GitHub Pages

De workflow in `.github/workflows/deploy-pages.yml` publiceert iedere push naar `main` via GitHub Pages.

De site gebruikt geen API-sleutels, geen buildstap en geen externe inhoudelijke databronnen. De workflow heeft uitsluitend de standaardrechten die nodig zijn voor GitHub Pages.

## Vervolg

De opzet is bewust eenvoudig gehouden. Een latere automatische wekelijkse editie kan nieuwe archiefitems genereren, en een EPUB-export kan als afzonderlijk publicatie-artefact worden toegevoegd zonder de publieke site of secrets te wijzigen.
