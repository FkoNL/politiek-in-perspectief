# Politiek in Perspectief

Een rustige, openbare Nederlandstalige site met wekelijkse politieke context.

## Lokaal bekijken

Open `index.html` in een browser, of start vanuit deze map een eenvoudige lokale webserver.

## Publiceren via GitHub Pages

1. Maak een nieuwe GitHub-repository en push deze bestanden naar de branch `main`.
2. Ga op GitHub naar **Settings → Pages** en kies bij *Build and deployment* voor **GitHub Actions**.
3. De workflow in `.github/workflows/deploy-pages.yml` publiceert iedere push naar `main`.

De openbare site bevat geen API-sleutels. De workflow heeft uitsluitend de standaardrechten die nodig zijn voor GitHub Pages.

## Automatische weekeditie

De workflow `.github/workflows/wekelijkse-concepteditie.yml` maakt en publiceert iedere maandag om **06:00 Nederlandse tijd** een nieuwe editie over de afgelopen maandag tot en met zondag. Om 06:20 volgt een reservepoging. Als de editie al bestaat, wordt de generatie overgeslagen; er worden dan geen nieuwe OpenAI-aanroepen gedaan.

De instructies staan in `prompts/weekly-edition.md`. De editie bevat een samenvatting, een navigeerbare inhoudsopgave, bronvermeldingen en per onderwerp vier onderdelen: wat er gebeurde, waarom het telt, wat volgt en wat te volgen. De streefduur is 10–15 minuten; korter mag wanneer de bronnen minder inhoud bieden. Optionele bronstartpunten per publicatiedatum staan in `research/YYYY-MM-DD.md` en worden opnieuw gecontroleerd tijdens de generatie.

Na geslaagde generatie worden de editie, het archief en de oorspronkelijke AI-illustratie op `main` opgeslagen. De workflow roept vervolgens de Pages-publicatie rechtstreeks aan voor die exacte commit. Er is geen pull request of handmatige goedkeuring meer nodig. Als de generatie mislukt, blijft de bestaande editie staan. Een nieuwe uitvoering kan een al opgeslagen editie alsnog publiceren zonder haar opnieuw te genereren.

Voeg onder **Settings → Secrets and variables → Actions** één repository secret toe:

- `OPENAI_API_KEY` — de API-sleutel van het OpenAI-platform.

De sleutel wordt alleen tijdens de generatie gebruikt en staat niet in de repository of de publieke site. Voor GitHub-publicatie wordt de tijdelijke standaardtoken van Actions gebruikt; een extra API-sleutel is niet nodig.

### Handmatig uitvoeren of herzien

Open **Actions → Maak en publiceer wekelijkse editie → Run workflow**. Laat de publicatiedatum leeg voor vandaag, of vul een datum in om een editie in te halen. De verslagperiode is altijd de laatst voltooide maandag-zondagweek.

Vink **Maak en publiceer een herziene versie van een bestaande editie** aan om een bestaande editie opnieuw te maken en direct te vervangen.

## Wekelijkse podcastaflevering

Na de maandageditie en de Pages-publicatie maakt dezelfde workflow automatisch een volledige podcastaflevering. De aflevering gebruikt de gekozen stem **Marin**, in een rustig, journalistiek Nederlands tempo zonder versnelling achteraf. Het luisterscript wordt uitsluitend opgebouwd uit de zojuist gepubliceerde editie; de MP3, het transcript en de metadata komen in een concept-pull-request te staan en zijn daar direct te downloaden.

Een al bestaande aflevering met dezelfde broneditie wordt herkend. De reservepoging om 06:20 maakt dan geen tweede script of opname. Een handmatige uitvoering staat onder **Actions → Maak podcastaflevering**; kies alleen *opnieuw maken* als een nieuwe versie echt gewenst is.

Een speler op de website, een podcastfeed en distributie naar Apple Podcasts zijn afzonderlijke vervolgstappen.
