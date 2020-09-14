FROM ubuntu:latest

SHELL ["/bin/bash", "-c"]

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get upgrade -y && apt-get install -y supervisor nodejs npm chromium-browser fonts-liberation libappindicator3-1 lsb-release wget psmisc vim python3 python3-pip postgresql-client supervisor libgbm-dev libnss3-dev libxss1

RUN pip3 install z3-solver==4.8.7.0 ply

COPY src /crawly

COPY supervisord-config /etc/supervisor/conf.d/default.conf

WORKDIR /crawly
RUN sh install.sh

COPY tests /tests

ENTRYPOINT /usr/bin/supervisord