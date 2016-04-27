FROM iron/node:4

RUN mkdir /snr
ADD index.js /snr
ADD node_modules /snr
WORKDIR /snr

VOLUME ["/storage"]

CMD node index.js --storage /storage/ --port $PORT
