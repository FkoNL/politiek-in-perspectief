"""Publish a prepared carousel, with a durable checkpoint before publishing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.parse
import urllib.request


def api(endpoint, fields=None):
    version = os.environ.get("INSTAGRAM_API_VERSION", "v25.0")
    if not re.fullmatch(r"v\d+\.0", version):
        raise ValueError("Ongeldige API-versie")
    url = f"https://graph.instagram.com/{version}/{endpoint}"
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    request = urllib.request.Request(url, data=data, headers={
        "Authorization": "Bearer " + os.environ["INSTAGRAM_ACCESS_TOKEN"]})
    # Never include response bodies or request URLs containing credentials in logs.
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except Exception:
        raise RuntimeError("Instagram-aanroep mislukt; controleer account, token en rechten") from None


def checkpoint(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2) + "\n")
    for command in (["git", "add", str(path)],
                    ["git", "commit", "-m", f"Bewaar Instagramstatus {state['edition']}: {state['status']}"],
                    ["git", "pull", "--rebase", "origin", "main"],
                    ["git", "push", "origin", "HEAD:main"]):
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL)


def wait_ready(container):
    for _ in range(24):
        status = api(f"{container}?fields=status_code").get("status_code")
        if status == "FINISHED":
            return
        if status in ("ERROR", "EXPIRED", "PUBLISHED"):
            raise RuntimeError(f"Onverwachte containerstatus: {status}")
        time.sleep(5)
    raise RuntimeError("Instagram verwerkt media nog; er is niets gepubliceerd")


def public_images(manifest, base):
    if not base.startswith("https://"):
        raise ValueError("SITE_URL moet HTTPS gebruiken")
    urls = []
    directory = Path(f"assets/instagram/{manifest['edition']}")
    for name in manifest["images"]:
        if not re.fullmatch(r"\d{2}\.jpg", name):
            raise ValueError("Ongeldige afbeeldingsnaam")
        url = f"{base.rstrip('/')}/{directory.as_posix()}/{name}"
        with urllib.request.urlopen(url, timeout=30) as response:
            remote = response.read()
            if response.headers.get_content_type() != "image/jpeg":
                raise ValueError("Publieke afbeelding is geen JPEG")
        if hashlib.sha256(remote).digest() != hashlib.sha256((directory / name).read_bytes()).digest():
            raise ValueError("De afbeeldingen staan nog niet correct op de website")
        urls.append(url)
    if not 2 <= len(urls) <= 10:
        raise ValueError("Ongeldig aantal afbeeldingen")
    return urls


def publish(manifest, urls, state_path):
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state["status"] == "published":
            print("Deze editie is al gepubliceerd; overgeslagen")
            return
        if state["status"] == "pending":
            if api(f"{state['container']}?fields=status_code").get("status_code") == "PUBLISHED":
                state["status"] = "published"
                checkpoint(state_path, state)
                print("Eerdere publicatie bevestigd")
                return
            raise RuntimeError("Eerdere publicatie heeft een onzekere uitkomst. Controleer Instagram handmatig; niet opnieuw geplaatst.")
        raise RuntimeError("Onbekende publicatiestatus; handmatige controle vereist")
    account = os.environ["INSTAGRAM_USER_ID"]
    if not account.isdigit():
        raise ValueError("INSTAGRAM_USER_ID moet numeriek zijn")
    # The token must belong to the configured professional account.
    identity = api("me?fields=user_id,id")
    if str(identity.get("user_id", identity.get("id"))) != account:
        raise ValueError("Token hoort niet bij het ingestelde Instagram-account")
    children = []
    for url in urls:
        child = api(f"{account}/media", {"image_url": url, "is_carousel_item": "true"})["id"]
        wait_ready(child)
        children.append(child)
    parent = api(f"{account}/media", {"media_type": "CAROUSEL", "children": ",".join(children),
                                       "caption": manifest["caption"]})["id"]
    wait_ready(parent)
    state = {"edition": manifest["edition"], "status": "pending", "container": parent}
    # Push must succeed BEFORE the non-idempotent media_publish request.
    checkpoint(state_path, state)
    result = api(f"{account}/media_publish", {"creation_id": parent})
    if not result.get("id"):
        raise RuntimeError("Geen publicatie-ID ontvangen. Controleer Instagram; pending blijft staan.")
    state.update(status="published", media_id=result["id"])
    checkpoint(state_path, state)
    print("Carrousel gepubliceerd")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--edition", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.edition):
        raise ValueError("Ongeldig editie-ID")
    manifest = json.loads(Path(f"assets/instagram/{args.edition}/manifest.json").read_text())
    if manifest["edition"] != args.edition or not 1 <= len(manifest["caption"]) <= 2200:
        raise ValueError("Ongeldig manifest")
    urls = public_images(manifest, os.environ.get("SITE_URL", "https://politiekinperspectief.nl"))
    publish(manifest, urls, Path(f"instagram-state/{args.edition}.json"))


if __name__ == "__main__":
    main()
