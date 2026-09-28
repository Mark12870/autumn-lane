"""One-time public content/asset import. Run from the repository root."""
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import urlopen

ROOT = 'https://www.autumnlane.cz'

def download(url, target):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(url, timeout=40) as response:
        target.write_bytes(response.read())

class FeedParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.posts = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'a' and 'sbi_photo' in attrs.get('class', '').split():
            self.current = {'permalink': attrs['href']}
            sources = json.loads(attrs.get('data-img-src-set', '{}'))
            self.current['source'] = sources.get('640') or sources.get('320')
        if tag == 'img' and self.current:
            self.current['caption'] = attrs.get('alt', '')

    def handle_endtag(self, tag):
        if tag == 'a' and self.current:
            if self.current.get('source'):
                self.posts.append(self.current)
            self.current = None

assets = {
    '/wp-content/uploads/2025/01/AL_LOGOTYP_HORIZONTAL.png': 'public/images/logo.png',
    '/wp-content/uploads/2025/01/DSCF7645.jpg': 'src/assets/band.jpg',
    '/wp-content/uploads/2025/06/EatenByMindv4_withLogo-1024x1024.png': 'src/assets/eaten-by-mind.png',
    '/wp-content/uploads/2024/09/World-of-Water.otf': 'public/fonts/world-of-water.otf',
}
for source, target in assets.items():
    download(ROOT + source, target)

parser = FeedParser()
with urlopen(ROOT, timeout=40) as response:
    parser.feed(response.read().decode())
posts = []
for i, post in enumerate(parser.posts):
    extension = Path(post['source']).suffix
    image = f'/images/instagram/imported-{i + 1}{extension}'
    download(post['source'], 'public' + image)
    posts.append({'id': f'imported-{i + 1}', 'permalink': post['permalink'],
                  'caption': post['caption'], 'image': image})
Path('src/content').mkdir(parents=True, exist_ok=True)
Path('src/content/instagram.json').write_text(json.dumps(
    {'updatedAt': None, 'source': 'wordpress-import', 'posts': posts},
    ensure_ascii=False, indent=2) + '\n')
print(f'Imported branding assets and {len(posts)} Instagram posts.')
