FROM node:22-alpine

# ffmpeg + libass burn the subtitles; fontconfig + fonts give libass the
# brand fonts. Liberation Sans stands in for Arial (the neutral default look).
# Brand fonts (all SIL Open Font License) live in /usr/share/fonts/brand;
# add a client's font here when their style uses one that is not listed.
RUN apk add --no-cache ffmpeg fontconfig font-liberation font-dejavu wget \
 && mkdir -p /usr/share/fonts/brand \
 && cd /usr/share/fonts/brand \
 && for url in \
      https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/LilitaOne-Regular.ttf \
      https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-Regular.ttf \
      https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-Bold.ttf \
      https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-ExtraBold.ttf \
      https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-Black.ttf \
      https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Regular.ttf \
      https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf \
      https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-ExtraBold.ttf \
      https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Black.ttf \
      https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf \
      https://raw.githubusercontent.com/google/fonts/main/ofl/bebasneue/BebasNeue-Regular.ttf \
      https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Regular.ttf \
      https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Bold.ttf \
      https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Black.ttf \
    ; do wget -q "$url" || exit 1; done \
 && fc-cache -f

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

ENV SUBTITLE_FONTS_DIR=/usr/share/fonts/brand

EXPOSE 3000

CMD ["node", "index.js"]
