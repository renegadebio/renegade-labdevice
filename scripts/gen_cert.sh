#!/bin/bash

TLSDIR=$(dirname $0)/../tls
EXPIRATION_DAYS=365 # How many days from now do generated certs expire?

if [ "$#" -lt "1" ]; then
    echo "Usage: $0 <hostname>" >&2
    exit 1
fi

HOSTNAME=$1

if [ -f "${TLSDIR}/client-cert.pem" ]; then
    echo "Certificate already exists" >&2
    exit 1
fi

mkdir -p $TLSDIR
cd $TLSDIR

echo "Generating certificate..."

openssl genrsa -out client-key.pem 4096
if [ ! "$?" -eq "0" ]; then
    echo "Failed to generate key" >&2
    exit 1
fi

openssl req -new -key client-key.pem -out client-csr.pem -subj "/CN=$HOSTNAME"
if [ ! "$?" -eq "0" ]; then
    echo "Failed to certificate signing request for hostname $HOSTNAME" >&2
    exit 1
fi

openssl x509 -req -in client-csr.pem -signkey client-key.pem -days $EXPIRATION_DAYS -out client-cert.pem
if [ ! "$?" -eq "0" ]; then
    echo "Failed to generate certificate" >&2
    exit 1
fi

echo "Certificate generated!"
