export interface Campaign {
  kicker: string;
  headline: string;
  headlineAccent: string;
  sub: string;
  ctaLabel: string;
}

export interface LpWorkItem {
  client: string;
  title: string;
  href: string;
  video?: string;
  youtubeId?: string;
}

export const CAMPAIGNS: Record<string, Campaign> = {
  founders: {
    kicker: 'Brand films for founders',
    headline: "We don't make video.\nWe make people",
    headlineAccent: 'know you.',
    sub: 'For founders who want to build brand trust, not just awareness. We dig deep into what really needs to be said — then say it strong.',
    ctaLabel: "Let's make them feel something",
  },
  nonprofits: {
    kicker: 'Fundraising video production',
    headline: "Videos that open checkbooks,\nnot just get",
    headlineAccent: 'applause.',
    sub: 'For missions that deserve more than a polite crowd. We build campaign films that move people to give.',
    ctaLabel: 'Start your campaign',
  },
  healthcare: {
    kicker: 'Healthcare video production',
    headline: "Build trust before they\never",
    headlineAccent: 'meet you.',
    sub: 'For practices and services where trust is the deciding factor. We build it on video, before the first call.',
    ctaLabel: 'Talk about your project',
  },
};

export const LP_WORK_BY_CAMPAIGN: Record<string, LpWorkItem[]> = {
  founders: [
    {
      client: 'NYPD',
      title: 'Training Videos',
      video: 'https://dl.dropboxusercontent.com/scl/fi/z30x451ca87sb3lae8ms0/nypd-720p.mp4?rlkey=1t68meyorkjy6vala2l0nptg8',
      href: '/work/training-videos',
    },
    {
      client: 'Home Vet',
      title: 'Here to Eternity',
      video: 'https://dl.dropboxusercontent.com/scl/fi/f1kfv427kfd9f76w80r4s/main-video-6.21.24-with-out-subs.mov?rlkey=8392crpsaw2jevh2t0petoknk',
      href: '/work/home-vet',
    },
    {
      client: 'Elijah Diaz',
      title: 'Elijah Diaz',
      video: 'https://dl.dropboxusercontent.com/scl/fi/32hqqnsnlavsslrdg5egh/Michal-Hartman-2025-11-12-16.43.34.mp4?rlkey=ovkgqzzpe5evmtfeqqsuidnb8',
      href: '/work/elijah-deiz',
    },
    {
      client: 'Cross River Therapy',
      title: 'Cross River Therapy ABA',
      youtubeId: 'QUnszsAoJx8',
      href: '/work/cross-river-aba',
    },
  ],
  nonprofits: [
    { client: 'Building Campaign', title: 'Imagine the Future', video: 'https://dl.dropboxusercontent.com/s/tw9ss2ncet1asva/7.1%20for%20aproval%201055%20am%20.mov', href: '/work/imagine-the-future' },
    { client: 'Orlando Community Kollel', title: 'Creating Buy In', video: 'https://dl.dropboxusercontent.com/scl/fi/6w1aiym31b18bm0luruxl/v4.8-orlando-Kollel-Causematch-2.10-1050-am-dc-with-subs.mov?rlkey=9bmwip04wcxld47a42cwn0im3', href: '/work/orlando-kollel-buy-in' },
    { client: 'Home Vet', title: 'Trust in the Hardest Moment', video: 'https://dl.dropboxusercontent.com/scl/fi/f1kfv427kfd9f76w80r4s/main-video-6.21.24-with-out-subs.mov?rlkey=8392crpsaw2jevh2t0petoknk', href: '/work/home-vet' },
    { client: 'Meoros Orlando', title: 'First Impression, Millions at Stake', video: 'https://dl.dropboxusercontent.com/scl/fi/s64kwfqv7706armqhdueh/Meoros-Orlando-how-far-we-come-v5-5-pm-10.27-dc.mov?rlkey=2h4o0nn1ghea5lako05atgecm', href: '/work/meoros-orlando' },
    { client: 'Rabbi Oelbaum 50-Year', title: 'Telling The World About Our Leaders', video: 'https://dl.dropboxusercontent.com/scl/fi/41a1c5cmr2m0aa8jbjm4z/Rabbi-Oelbaim-main-video-v3.5-12.7-11.26-am-dc.mov?rlkey=yxlia7e0jp21x9i6ekcrlh76k', href: '/work/oelbaum-50-year-dinner' },
    { client: 'Gibor', title: 'More Than Kicking and Punching', video: 'https://dl.dropboxusercontent.com/scl/fi/lrk9cr2qxu4oo1eccv9nj/Gibor-final-short-video-v3_v4.mov?rlkey=tvt7gd9ox50sly7ymmvjhjs9o', href: '/work/gibor' },
  ],
  healthcare: [
    {
      client: 'Home Vet',
      title: 'Here to Eternity',
      video: 'https://dl.dropboxusercontent.com/scl/fi/f1kfv427kfd9f76w80r4s/main-video-6.21.24-with-out-subs.mov?rlkey=8392crpsaw2jevh2t0petoknk',
      href: '/work/home-vet',
    },
    {
      client: 'Ezra',
      title: 'Covid Epicenter Lifesavers',
      video: 'https://dl.dropboxusercontent.com/s/f97pwa89bxigoq2/Ezra_v15%20BLUR%20Patient.mp4',
      href: '/work/covid-epicenter-lifesavers',
    },
    {
      client: 'Cross River Therapy',
      title: 'Cross River Therapy ABA',
      youtubeId: 'QUnszsAoJx8',
      href: '/work/cross-river-aba',
    },
    {
      client: 'Imperial Advisory',
      title: 'Homecare Miami, State of the Union',
      video: 'https://dl.dropboxusercontent.com/scl/fi/csc4efaqn78aajex6c1ol/Imperial-Advisory-Homecare-State-of-the-Union-v2.2.mov?rlkey=tg4brd0033en3g3fhgjf06qye',
      href: '/work/homecare-miami',
    },
  ],
};

/** @deprecated use LP_WORK_BY_CAMPAIGN instead */
export const LP_FEATURED_WORK = LP_WORK_BY_CAMPAIGN.nonprofits;
