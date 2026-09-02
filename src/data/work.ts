export type WorkKind = 'dropbox-direct' | 'youtube' | 'vimeo' | 'instagram' | 'dropbox-preview';

export interface WorkEntry {
  slug: string;
  title: string;
  client: string;
  sector: string;
  featured?: number;
  words: number;
  kind: WorkKind;
  video: string;
  href?: string;
}

function dropboxDirect(url: string): string {
  return url
    .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
    .replace(/[?&]dl=0/, '');
}

const raw: WorkEntry[] = [
  { slug:'imagine-the-future', title:'Imagine the Future', client:'Building Campaign', sector:'Nonprofit', featured:1, words:118,
    kind:'dropbox-direct', video:'https://dl.dropboxusercontent.com/s/tw9ss2ncet1asva/7.1%20for%20aproval%201055%20am%20.mov', href:'https://attentionearned.com/imagine-the-future/' },
  { slug:'orlando-kollel-buy-in', title:'Creating Buy In', client:'Orlando Community Kollel', sector:'Nonprofit', featured:2, words:79,
    kind:'dropbox-direct', video:'https://dl.dropboxusercontent.com/scl/fi/6w1aiym31b18bm0luruxl/v4.8-orlando-Kollel-Causematch-2.10-1050-am-dc-with-subs.mov?rlkey=9bmwip04wcxld47a42cwn0im3', href:'https://attentionearned.com/orlando-community-kollel-creating-buy-in/' },
  { slug:'oelbaum-50-year-dinner', title:'Rabbi Noach Issac Oelbaum, 50 Year Dinner', client:'Oelbaum Family', sector:'Nonprofit', featured:3, words:607,
    kind:'dropbox-direct', video:'https://dl.dropboxusercontent.com/scl/fi/41a1c5cmr2m0aa8jbjm4z/Rabbi-Oelbaim-main-video-v3.5-12.7-11.26-am-dc.mov?rlkey=yxlia7e0jp21x9i6ekcrlh76k', href:'https://attentionearned.com/rabbi-noach-issac-oelbaum-50-year-dinner/' },
  { slug:'meoros-orlando', title:'Meoros Girls High School Orlando', client:'Meoros Orlando', sector:'Nonprofit', featured:5, words:110,
    kind:'dropbox-direct', video:'https://dl.dropboxusercontent.com/scl/fi/s64kwfqv7706armqhdueh/Meoros-Orlando-how-far-we-come-v5-5-pm-10.27-dc.mov?rlkey=2h4o0nn1ghea5lako05atgecm', href:'https://attentionearned.com/meoros-girls-high-school-orlando/' },
  { slug:'chabad-cheder-building', title:'Chabad Cheder Building Campaign', client:'Chabad Cheder', sector:'Nonprofit', words:31,
    kind:'dropbox-direct', video:'https://dl.dropboxusercontent.com/scl/fi/7ye355lunjmt4v3yovmqb/cv-4.6-1.27-pm-6.5.25-dc.mov?rlkey=7fzsmdnfxdcul4tb2cgtncmq7' },
  { slug:'darchei-torah-50-year', title:'50 Year Documentary for Darchei Torah', client:'Darchei Torah', sector:'Nonprofit', words:22,
    kind:'dropbox-preview', video:'https://www.dropbox.com/s/o0uu34keldv1f8z/Final%20Yovel%20Documentary_Darchei.mp4?dl=0' },
  { slug:'turo-weisberg-honoree', title:'Turo University, Dr. Weisberg Honoree Video', client:'Turo University', sector:'Nonprofit', words:25,
    kind:'dropbox-preview', video:'https://www.dropbox.com/s/maf40l07ginmxva/Joe%20Weisberg%20April%205th%20v3.mp4?dl=0' },
  { slug:'tag-of-queens', title:'Tag of Queens Campaign', client:'Tag of Queens', sector:'Nonprofit', words:17,
    kind:'dropbox-preview', video:'https://www.dropbox.com/scl/fi/bx2h5lolwxdztib6ppab3/Tag-Chardy-v2.3-for-website.mov?rlkey=tevb463i3a96mxnehz114d1im' },
  { slug:'home-vet', title:'Here to Eternity', client:'Home Vet', sector:'Healthcare', featured:4, words:347,
    kind:'dropbox-direct', video:'https://dl.dropboxusercontent.com/scl/fi/f1kfv427kfd9f76w80r4s/main-video-6.21.24-with-out-subs.mov?rlkey=8392crpsaw2jevh2t0petoknk', href:'https://attentionearned.com/here-to-eternity-home-vet/' },
  { slug:'covid-epicenter-lifesavers', title:'Covid Epicenter Lifesavers', client:'', sector:'Healthcare', words:54,
    kind:'dropbox-preview', video:'https://www.dropbox.com/s/f97pwa89bxigoq2/Ezra_v15%20BLUR%20Patient.mp4?dl=0' },
  { slug:'cross-river-aba', title:'Cross River Therapy ABA', client:'Cross River Therapy', sector:'Healthcare', words:29,
    kind:'youtube', video:'QUnszsAoJx8' },
  { slug:'homecare-miami', title:'Homecare Miami, State of the Union', client:'Imperial Advisory', sector:'Healthcare', words:28,
    kind:'dropbox-direct', video:'https://dl.dropboxusercontent.com/scl/fi/csc4efaqn78aajex6c1ol/Imperial-Advisory-Homecare-State-of-the-Union-v2.2.mov?rlkey=tg4brd0033en3g3fhgjf06qye' },
  { slug:'zevi-giniger', title:'Are You There', client:'Zevi Giniger', sector:'Music video', words:87, kind:'youtube', video:'Wrm74AJAFtE' },
  { slug:'ayeka-avrumy-straus', title:'Ayeka', client:'Avrumy Straus', sector:'Music video', words:63, kind:'youtube', video:'w5HPX-EibF0' },
  { slug:'kol-zman', title:'Kol Zman', client:'Shulem Lemmer ft. Hershy Rottenberg', sector:'Music video', words:54,
    kind:'dropbox-direct', video:'https://dl.dropboxusercontent.com/scl/fi/41lm31lp53uibm0irx6zu/Kol-Zman-Shulem-Lemmer-ft.-Hershy-Rottenberg.mp4?rlkey=nqiwz5eoz27l32uotj6ol8a9u' },
  { slug:'yitzi-waldner', title:'Eimosai', client:'Yitzi Waldner', sector:'Music video', words:36, kind:'youtube', video:'FKj0SsP00gA' },
  { slug:'8th-day', title:'Gan Is a Garden', client:'8th Day', sector:'Music video', words:34, kind:'youtube', video:'OFhL09kPAZY' },
  { slug:'life-is-a-highway', title:'Life Is a Highway', client:'The Eleanor', sector:'Music video', words:33, kind:'youtube', video:'u7rJiYLtLhY' },
  { slug:'we-are-the-music', title:'We Are the Music', client:'Moshe Willshanski', sector:'Music video', words:31, kind:'youtube', video:'BaKdRIWzz3Q' },
  { slug:'gibor', title:'Gibor', client:'Gibor', sector:'Commercial', featured:6, words:64,
    kind:'dropbox-direct', video:'https://dl.dropboxusercontent.com/scl/fi/lrk9cr2qxu4oo1eccv9nj/Gibor-final-short-video-v3_v4.mov?rlkey=tvt7gd9ox50sly7ymmvjhjs9o', href:'https://attentionearned.com/gebor/' },
  { slug:'gourmet-glatt-reels', title:'Gourmet Glatt Reels', client:'Gourmet Glatt', sector:'Commercial', words:29,
    kind:'instagram', video:'https://www.instagram.com/reel/C5BUg9UL2Zn/' },
  { slug:'nexivity-ad', title:'Nexivity Ad', client:'Nexivity', sector:'Commercial', words:29, kind:'youtube', video:'XZzPeJ2xYkA' },
  { slug:'gabi-koyenov', title:'Gabi Koyenov', client:'', sector:'Behind-the-scenes', words:137, kind:'youtube', video:'KL4E2VWYOtQ' },
  { slug:'why-i-do-this', title:'Why I Do This', client:'', sector:'Behind-the-scenes', words:78, kind:'youtube', video:'LmnF9frWJas' },
  { slug:'devorahs-hope', title:"Devorah's Hope", client:'', sector:'Film', words:47,
    kind:'dropbox-preview', video:'https://www.dropbox.com/s/mpjfa3n66bc6llq/FULL%20CUT%20of%20Devorahs%20Hope%203.0-.mp4?dl=0' },
  { slug:'maafa', title:'Maafa', client:'', sector:'Film', words:13, kind:'youtube', video:'D8ukI1zoPwQ' },
  { slug:'ocean-body', title:'Ocean Body', client:'', sector:'Fashion', words:35, kind:'vimeo', video:'490874426' },
  { slug:'feil-cosmetics', title:'Feil Cosmetics', client:'', sector:'Fashion', words:13, kind:'youtube', video:'38bGdJSEEqk' },
  { slug:'elijah-deiz', title:'Elijah Deiz', client:'', sector:'Corporate', words:75,
    kind:'dropbox-direct', video:'https://dl.dropboxusercontent.com/scl/fi/32hqqnsnlavsslrdg5egh/Michal-Hartman-2025-11-12-16.43.34.mp4?rlkey=ovkgqzzpe5evmtfeqqsuidnb8' },
  { slug:'training-videos', title:'Training Videos', client:'NYPD', sector:'Corporate', words:73,
    kind:'dropbox-preview', video:'https://www.dropbox.com/scl/fi/z30x451ca87sb3lae8ms0/nypd-720p.mp4?rlkey=1t68meyorkjy6vala2l0nptg8' },
];

export const AE_WORK: WorkEntry[] = raw.map((w) => {
  if (w.kind === 'dropbox-preview') {
    return { ...w, video: dropboxDirect(w.video), kind: 'dropbox-direct' as WorkKind };
  }
  return w;
});

export const AE_SECTORS = [
  'All', 'Corporate', 'Healthcare', 'Nonprofit', 'Film',
  'Music video', 'Commercial', 'Fashion', 'Behind-the-scenes',
];

export function getMediaFor(w: WorkEntry): { type: 'video'; src: string } | { type: 'iframe'; src: string } | { type: 'link'; src: string } {
  if (w.kind === 'dropbox-direct') return { type: 'video', src: w.video };
  if (w.kind === 'youtube') return { type: 'iframe', src: `https://www.youtube.com/embed/${w.video}` };
  if (w.kind === 'vimeo') return { type: 'iframe', src: `https://player.vimeo.com/video/${w.video}` };
  if (w.kind === 'instagram') return { type: 'iframe', src: w.video.replace(/\/$/, '') + '/embed/' };
  return { type: 'link', src: w.video };
}

export function getPlatformLabel(w: WorkEntry): string {
  if (w.kind === 'youtube') return 'YouTube';
  if (w.kind === 'vimeo') return 'Vimeo';
  if (w.kind === 'instagram') return 'Instagram';
  return 'Video';
}

export function getYoutubeThumbnail(w: WorkEntry): string | null {
  if (w.kind === 'youtube') return `https://img.youtube.com/vi/${w.video}/hqdefault.jpg`;
  return null;
}

export const MDX_SLUG_MAP: Record<string, string> = {
  'imagine-the-future': 'imagine-the-future',
  'orlando-kollel-buy-in': 'orlando-community-kollel-creating-buy-in',
  'oelbaum-50-year-dinner': 'rabbi-noach-issac-oelbaum-50-year-dinner',
  'meoros-orlando': 'meoros-girls-high-school-orlando',
  'chabad-cheder-building': 'chabad-cheder-building-campaign',
  'darchei-torah-50-year': '50-year-documentary-for-darchai-torah',
  'turo-weisberg-honoree': 'turo-university-dr-weisberg-honoree-video',
  'tag-of-queens': 'tagqueens',
  'home-vet': 'here-to-eternity-home-vet',
  'covid-epicenter-lifesavers': 'covid-epicenter-lifesavers',
  'cross-river-aba': 'cross-river-therapy-aba',
  'homecare-miami': 'homecare-miami-state-of-the-union',
  'zevi-giniger': 'zevi-giniger-are-you-there',
  'ayeka-avrumy-straus': 'ayeka-avrumy-straus',
  'kol-zman': 'shulem',
  'yitzi-waldner': 'yitzi-waldner-eimosai',
  '8th-day': '8th-day-gan-is-a-garden',
  'life-is-a-highway': 'life-is-a-highway-the-eleanor',
  'we-are-the-music': 'we-are-the-music-moshe-willshanski',
  'gibor': 'gebor',
  'gourmet-glatt-reels': 'gourmet-glatt-reels',
  'nexivity-ad': 'nexivity-ad',
  'why-i-do-this': 'why-i-do-this',
  'devorahs-hope': 'devorahs-hope',
  'maafa': 'maafa',
  'feil-cosmetics': 'feil-cosmetics',
  'elijah-deiz': 'elijah-deiz',
  'training-videos': 'training-videos',
};
