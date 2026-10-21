# Politiek in Perspectief

Een rustige, openbare Nederlandstalige site met wekelijkse politieke context.

## Lokaal bekijken

Open `index.html` in een browser, of start vanuit deze map een eenvoudige lokale webserver.

## Publiceren via GitHub Pages

1. Maak een nieuwe GitHub-repository en push deze bestanden naar de branch `main`.
2. Ga op GitHub naar **Settings → Pages** en kies bij *Build and deployment* voor **GitHub Actions**.
3. De workflow in `.github/workflows/deploy-pages.yml` publiceert iedere push naar `main`.

De openbare site bevat geen API-sleutels. De workflow heeft uitsluitend de standaardrechten die nodig zijn voor GitHub Pages.

## Wekelijkse concepteditie

De workflow `.github/workflows/wekelijkse-concepteditie.yml` loopt elke maandag om 07:00 UTC. Hij gebruikt de OpenAI Responses API met webzoeking om een concepteditie te maken, inclusief klikbare bronvermeldingen én één oorspronkelijke, AI-gegenereerde weekillustratie. De workflow opent daarna een pull request; de site wordt pas gepubliceerd nadat die pull request is gecontroleerd en samengevoegd in `main`.

Voeg vóór de eerste uitvoering in GitHub onder **Settings → Secrets and variables → Actions** één repository secret toe:

- `OPENAI_API_KEY` — de API-sleutel van het OpenAI-platform.

De sleutel wordt alleen tijdens de workflow gebruikt en wordt niet opgeslagen in de repository of de publieke site. De gegenereerde illustratie bevat geen portretten, politieke logo's, tekst of nieuwsbeelden en wordt bij de editie opgeslagen.

## Vervolg

De opzet is bewust eenvoudig gehouden. Een latere automatische wekelijkse editie kan nieuwe archiefitems genereren, en een EPUB-export kan als afzonderlijk publicatie-artefact worden toegevoegd zonder de publieke site of secrets te wijzigen.
