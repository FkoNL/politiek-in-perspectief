# Instagram weekcarrousel

De workflow `Instagram weekcarrousel` sluit aan op een geslaagde uitvoering van
`Maak en publiceer wekelijkse editie`. De bestaande websiteworkflow blijft intact.
Automatische Instagrampublicatie staat standaard uit.

## Eenmalige koppeling

1. Maak in [Meta for Developers](https://developers.facebook.com/) een app met
   **Instagram API with Instagram Login** voor het professionele projectaccount.
   Deze implementatie gebruikt de directe Instagram-route, niet Facebook Login.
2. Geef het eigen account de benodigde app-/testrol en doorloop de autorisatie.
   Nodig zijn `instagram_business_basic` en `instagram_business_content_publish`.
   Gebruik voor productie een daarvoor geschikt langlevend toegangstoken, geen
   tijdelijk token uit een proef. Meta kan aanvullende installatie- of
   verificatiestappen vragen; volg de actuele instructies in het dashboard.
3. Voeg onder repository **Settings → Secrets and variables → Actions → Secrets** toe:
   - `INSTAGRAM_ACCESS_TOKEN`: het toegangstoken voor dit projectaccount.
   - `INSTAGRAM_USER_ID`: het numerieke ID dat bij dit Instagram-account hoort.
   `OPENAI_API_KEY` bestaat al voor de website.
4. Controleer in Meta welke Graph API-versie je app gebruikt. Stel zo nodig de
   Actions-variable `INSTAGRAM_API_VERSION` in (standaard `v25.0`).
   De tekstgenerator gebruikt dezelfde modelnaam als de website; een andere
   modelnaam kan via `INSTAGRAM_TEXT_MODEL`.

**Plak toegangstokens niet in chats, issues, commits of workflowlogs.**
Tokens kunnen verlopen of worden ingetrokken. Deze eerste versie vernieuwt ze
niet automatisch: beheer de geldigheid in Meta en vervang het GitHub Secret
tijdig. Bij een ongeldig token stopt de workflow en blijft de website werken.

## Eerst een proef

Na samenvoegen van de branch: **Actions → Instagram weekcarrousel → Run workflow**.
Laat `publish` uit. Het editie-ID is de zondag aan het eind van de verslagweek,
bijvoorbeeld `2026-10-25`; leeg kiest de nieuwste gedateerde editie.
Download de artifact `instagram-<editie>`: losse JPEG's van 1080 × 1350 pixels,
plus een manifest met teksten en bijschrift. Er wordt niets op Instagram
geplaatst en er wordt in proefmodus niets naar `main` geschreven.

Controleer de korte teksten tegen de bronnen en bekijk alle kaarten op een
telefoonscherm. Dit sjabloon benadert de goedgekeurde stijlopzet met warm wit,
donkerblauw en groen; de beeldgenerator wordt niet wekelijks aangeroepen.
Samenvattingen door AI blijven vatbaar voor fouten en krijgen geen onafhankelijke
feitencontrole in deze stap.

## Eerste publicatie en daarna automatisch

Voer de workflow opnieuw uit met `publish` aan voor een eenmalige echte publicatie.
De kaarten worden dan in `assets/instagram/<editie>/` opgeslagen en via Pages
gepubliceerd. Pas na geslaagde deploy en controle van de publiek beschikbare
JPEG-bytes vraagt het script Instagram de carrousel te plaatsen.

Stel na de geslaagde eerste proef de Actions-variable
`INSTAGRAM_AUTO_PUBLISH` in op `true` om dit na iedere geslaagde weekeditie te
herhalen. Er is geen tweede klok: de flow volgt de bestaande maandagworkflow,
inclusief de reservepoging en eventuele handmatige uitvoeringen daarvan.

## Dubbele posts en storingen

- Per editie wordt een status bewaard in `instagram-state/<editie>.json`.
- Vóór het daadwerkelijke plaatsen wordt `pending` naar `main` gepusht.
  Lukt dat niet, dan wordt geen publicatieverzoek verstuurd.
- Na bevestiging wordt de status `published`; volgende uitvoeringen slaan die
  editie over. Een herziene website-editie vervangt geen bestaand Instagrambericht.
- Bij een timeout ná het plaatsingsverzoek kan Instagram het bericht al hebben
  geplaatst. Een volgende uitvoering controleert de containerstatus. Bij
  `PUBLISHED` wordt de lokale administratie hersteld. Bij iedere andere status
  stopt de flow voor handmatige controle en plaatst hij geen tweede bericht.
- Verwijder een `pending`-bestand alleen nadat je handmatig hebt vastgesteld dat
  er geen post is geplaatst en dat de eerdere container niet alsnog publiceert.
- Gewijzigde broninhoud bij bestaande kaarten stopt de generator voor controle.
  Verwijder of vervang een manifest niet blind bij een al gepubliceerde editie.

De statusbestanden bevatten alleen editie-/container-/publicatie-ID's, geen tokens.
De carrousel is openbaar nadat de liveflow haar afbeeldingen naar Pages deployt.

## Lokaal controleren

```sh
python3 -m unittest discover -s tests -p 'test_instagram*.py'
python3 -m pip install 'Pillow>=11,<13'
python3 scripts/instagram_cards.py --edition 2026-10-25
```

De renderer verwacht Liberation-fonts (Ubuntu-pakket `fonts-liberation2`). Elders
kan `INSTAGRAM_FONT_DIR` verwijzen naar een map met `LiberationSerif-Bold.ttf` en
`LiberationSans-Regular.ttf`. Een gecontroleerd tekstbestand kan via
`--cards-json pad/naar/kaarten.json` zonder AI-aanroep worden gerenderd.

Referenties: [Meta content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/),
[Meta Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/).
