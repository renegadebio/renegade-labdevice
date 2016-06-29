
This is a work in progress. Do not expect everything to work.

A small node app that runs on a single board computer (e.g. a Beagle Bone Black) hooked up to a thermal label printer (e.g. a Brother QL-570) and connects securely to a bionet server which lets the server command print labels on the printer.

Connections are made using [ssh2](https://github.com/mscdex/ssh2).

# Supported printers

* Brother QL-570
* Brother QL-700

Other similar models may work but have not been tested.

# Dependencies

## installing node.js

You might already have node.js installed. If so, ensure it is a recent version. If not, first log in as the non-root user you intend to run this application, then install nvm (node version manager):

```
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.2/install.sh | bash
```

Log out, then log back in, then use nvm to install node:

```
nvm install 4.4.7
```

Now clone this repository into the user's homedir:

```
cd ~/
git clone https://github.com/biobricks/bionet-labelprinter
```

To install the node dependencies do:

```
cd bionet-labelprinter/
npm install
```

## printer driver

To install the C program that talks to the printer, fetch the ql-printer-driver repository:

```
git clone https://github.com/biobricks/ql-printer-driver
```

and follow the instructions in the included README.md

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

Ensure your user has write access to the printer device defined in the settings file. On ubuntu/debian systems you can do this using:

```
sudo usermod -a -G lp myUser
```

Where `myUser` is the username of the user that will be runnning this program. You will have to log out and log back in for the change to take effect.

Ensure that the generated private key is only readable by root and the user that will be running the this program.

# Running

Then run:

```
npm start
```

# Setting up for production

The bionet-labelprinter software should be installed under a non-root user account, so as root add a user account, e.g:

```
adduser bionet
```

Then log in as that user, ensure you are in the user's homedir and follow the instructions at the top of the README for installing this application and its dependencies. 

Now for making the app auto start when the computer boots and auto restart when it crashes.

First install the psy process monitor globally:

```
npm install -g psy
```

Then as root:

```
sudo cp production/bionet-labelprinter.initd /etc/init.d/bionet-labelprinter
chmod 755 /etc/init.d/bionet-labelprinter
```

If you used a different username than `bionet` then you'll need to change the `runAsUser` line in the init.d file.

Test that it works. As root do:

```
/etc/init.d/bionet-labelprinter start
```

If it's working make it auto-start on reboot:

```
update_rc.d bionet-labelprinter defaults
```

# ToDo

* Start as root, read private key, drop permissions

# License and Copyright

License is GPLv3

* Copyright 2016 BioBricks Foundation 

