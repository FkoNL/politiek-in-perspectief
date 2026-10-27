import importlib.util
import json
from pathlib import Path
import tempfile
import importlib.util
import unittest
from unittest.mock import patch


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / 'scripts' / f'{name}.py')
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


cards = module('instagram_cards')
publisher = module('instagram_publish')


class InstagramTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec('PIL') and any(Path('/usr/share/fonts/truetype', folder, 'LiberationSerif-Bold.ttf').exists() for folder in ('liberation2', 'liberation')), 'Pillow en Linux-lettertypen vereist')
    def test_render_long_cards_in_instagram_dimensions(self):
        from PIL import Image
        data = {'intro': 'Studierente, digitale veiligheid en Europese regels', 'caption': 'Context', 'cards': [
            {'headline': 'Een renteplafond met een hogere rekening',
             'body': 'Het voorgestelde plafond voor studieleningen kost volgens het ministerie minstens €160 miljoen per jaar. Er is €40 miljoen gereserveerd.',
             'status': 'NOG GEEN NIEUW BESLUIT', 'footer': 'De Kamer bespreekt de vervolgstappen.'},
            {'headline': 'Een bedrijf starten over grenzen heen',
             'body': 'EU Inc. moet ondernemen in meerdere EU-landen eenvoudiger maken. De lidstaten hebben hun inzet bepaald.',
             'status': 'ONDERHANDELINGSPOSITIE', 'footer': 'Het is nog geen geldende regeling.'}]}
        with tempfile.TemporaryDirectory() as directory:
            names = cards.render(cards.validate(data), Path(directory), '19 oktober 2026–25 oktober 2026')
            self.assertEqual(len(names), 4)
            for name in names:
                with Image.open(Path(directory) / name) as image:
                    self.assertEqual(image.size, (1080, 1350))
                    self.assertEqual(image.format, 'JPEG')

    def test_generation_schema_enforces_text_limits(self):
        from unittest.mock import MagicMock
        data = {'intro': 'Studierente en digitale veiligheid', 'caption': 'Context', 'cards': [
            {'headline': 'Kop', 'body': 'Inhoud', 'status': '', 'footer': ''}]}
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({
            'status': 'completed', 'output': [{'content': [
                {'type': 'output_text', 'text': json.dumps(data)}]}]}).encode()
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test'}), patch.object(cards.urllib.request, 'urlopen', return_value=response) as request:
            self.assertEqual(cards.summarize('Bron', 'test'), data)
        payload = json.loads(request.call_args.args[0].data)
        schema = payload['text']['format']['schema']['properties']
        self.assertEqual(schema['intro']['maxLength'], 110)
        self.assertEqual(schema['cards']['items']['properties']['body']['maxLength'], 350)

    def test_source_keeps_status_and_removes_scripts(self):
        text = cards.edition_text('<h3>Voorlopig akkoord</h3><p>Nog niet definitief &amp; meer volgt.</p><script>ignore()</script>')
        self.assertIn('Voorlopig akkoord', text)
        self.assertIn('Nog niet definitief & meer volgt.', text)
        self.assertNotIn('ignore', text)

    def test_oversized_text_is_rejected(self):
        data = {'intro': 'Intro', 'caption': 'Context', 'cards': [
            {'headline': 'Kop', 'body': 'x' * 351, 'status': '', 'footer': ''}]}
        with self.assertRaises(ValueError):
            cards.validate(data)

    def test_public_images_retry_until_all_bytes_match(self):
        from unittest.mock import MagicMock
        import urllib.error
        manifest = {'edition': '2026-10-25', 'images': ['01.jpg', '02.jpg']}
        def response(data):
            result = MagicMock()
            result.__enter__.return_value.read.return_value = data
            result.__enter__.return_value.headers.get_content_type.return_value = 'image/jpeg'
            return result
        with patch.object(Path, 'read_bytes', return_value=b'correct'), \
             patch.object(publisher.urllib.request, 'urlopen', side_effect=[
                 urllib.error.HTTPError('https://example.org', 404, 'Not found', None, None),
                 response(b'stale'), response(b'correct'), response(b'correct')]) as fetch, \
             patch.object(publisher.time, 'sleep') as sleep:
            urls = publisher.public_images(manifest, 'https://example.org')
        self.assertEqual(len(urls), 2)
        self.assertEqual(fetch.call_count, 4)
        self.assertEqual(sleep.call_count, 2)

    def test_public_images_fail_closed_when_unavailable(self):
        import urllib.error
        manifest = {'edition': '2026-10-25', 'images': ['01.jpg', '02.jpg']}
        with patch.object(Path, 'read_bytes', return_value=b'correct'), \
             patch.object(publisher.urllib.request, 'urlopen', side_effect=urllib.error.URLError('offline')), \
             patch.object(publisher.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'niets op Instagram geplaatst'):
                publisher.public_images(manifest, 'https://example.org')
        self.assertEqual(sleep.call_count, 12)

    def test_published_edition_is_not_published_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state.json'
            state.write_text(json.dumps({'status': 'published'}))
            with patch.object(publisher, 'api') as api:
                publisher.publish({'edition': '2026-10-25'}, [], state)
                api.assert_not_called()

    def test_ambiguous_publication_blocks_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state.json'
            state.write_text(json.dumps({'status': 'pending', 'container': '123'}))
            with patch.object(publisher, 'api', return_value={'status_code': 'FINISHED'}) as api:
                with self.assertRaises(RuntimeError):
                    publisher.publish({'edition': '2026-10-25'}, [], state)
                self.assertEqual(api.call_count, 1)

    def test_recover_confirmed_publication_without_second_post(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state.json'
            state.write_text(json.dumps({'edition': '2026-10-25', 'status': 'pending', 'container': '123'}))
            with patch.object(publisher, 'api', return_value={'status_code': 'PUBLISHED'}) as api, patch.object(publisher, 'checkpoint') as checkpoint:
                publisher.publish({'edition': '2026-10-25'}, [], state)
                checkpoint.assert_called_once()
                self.assertEqual(checkpoint.call_args.args[1]['status'], 'published')
                self.assertEqual(api.call_count, 1)

    def test_failed_checkpoint_prevents_publish_request(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state.json'
            responses = [{'id': '42'}, {'id': '1'}, {'id': '2'}, {'id': '3'}]
            with patch.dict('os.environ', {'INSTAGRAM_USER_ID': '42'}), patch.object(publisher, 'api', side_effect=responses) as api, patch.object(publisher, 'wait_ready'), patch.object(publisher, 'checkpoint', side_effect=RuntimeError('push failed')):
                with self.assertRaises(RuntimeError):
                    publisher.publish({'edition': '2026-10-25', 'caption': 'Test'}, ['a', 'b'], state)
                self.assertFalse(any('media_publish' in call.args[0] for call in api.call_args_list))


if __name__ == '__main__':
    unittest.main()

