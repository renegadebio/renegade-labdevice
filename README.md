
This is a work in progress. Do not expect everything to work.

A small node app that runs on a single board computer (e.g. a Beagle Bone Black) hooked up to a thermal label printer (e.g. a Brother QL-570) and connects securely to a bionet server which lets the server command print labels on the printer.

Connections are made using [ssh2](https://github.com/mscdex/ssh2).

# Supported printers

* Brother QL-570
* Brother QL-700

# Dependencies

To install the C program that talks to the printer:

```
sudo apt-get install build-essential
git clone https://github.com/sudomesh/ql570
cd ql570/
make
sudo make install
```

For the node dependencies do:

```
cd bionet-labelprinter/
npm install
```

# Generate key pair

```
ssh-keygen -t rsa -f mykey -N ""
```

# Setup

Copy the examples settings file:

```
cp settings.js.example settings.js
```

and edit to taste.

# Permissions

Ensure your user has write access to the printer device defined in the settings file.

Ensure that the generated private key is only readable by root and the user that will be running the this program.

# Running

Then run:

```
npm start
```

# Setting up for production

ToDo write me


# ToDo

* Start as root, read private key, drop permissions

# License and Copyright

License is GPLv3

* Copyright 2016 BioBricks Foundation 

