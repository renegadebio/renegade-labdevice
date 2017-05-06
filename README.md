
A small node app that is meant to run on a single-board computer and securely connects a physical lab device to a remote bionet node. Currently only 2D barcode label scanners and printers are supported.

Specifically, the following device-types are supported:

* USB barcode scanners that show up as a keyboard
* Plain USB webcams (for scanning DataMatrix codes only)
* USB thermal label printers (Brother QL-570 or QL-700)

For printers this allows printing from the bionet web app to in-lab thermal printers. 

For scanners this makes it possible to show scan results in the bionet web app when scanning on in-lab barcode scanners.

Connections are made using [ssh2](https://github.com/mscdex/ssh2).

# Supported barcode scanners

* Any USB scanner that shows up as a USB keyboard (e.g. Kercan KR-201)
* Any USB scanner that shows up as a webcam (e.g. SUMLUNG scanners from ebay/aliexpress)

# Supported label printers

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
nvm install 6.10 # or whatever the latest LTS release of node is
```

Now clone this repository into the user's homedir:

```
cd ~/
git clone https://github.com/biobricks/bionet-labdevice
```

To install the node dependencies do:

```
cd bionet-labdevice/
npm install
```

## bluetooth dependencies

For bluetooth support install:

```
sudo apt install bluetooth bluez libbluetooth-dev libudev-dev libcap2-bin
```

Then grant your node.js binary the `cap_net_raw` privilege to allow it to control the bluetooth chip without being run as root. As the user that will be running this program, run:

```
which node
```

and ctrl-c the output.

Then as root run:

```
setcap cap_net_raw+eip $(eval readlink -f <node_path>)
```

where `<node_path>` is the output from the `which node` command.

## printer driver dependencies

If you're using this with a printer install the C program that talks to the printer, fetch the ql-printer-driver repository:

```
git clone https://github.com/biobricks/ql-printer-driver
```

and follow the instructions in the included README.md

## webcam scanner dependencies

If you're using this with a webcam-based barcode scanner, install these packages:

```
sudo apt install streamer dmtx-utils v4l-utils
```

The `streamer` utility captures single frames from the webcam. `dmtx-utils` provides the `dmtxread` command that decodes DataMatrix codes from the captured image and `v4l-utils` sets the brightness and contrast of the webcam.

## HID/keyboard scanner dependencies

If you're using this with a USB barcode scanner that pretends to be a USB keyboard (most hand-held type USB barcode scanners are like this) then you might need:

```
sudo apt install build-essential git gcc-4.8 g++-4.8 libusb-1.0-0 libusb-1.0-0-dev
```

# Generate key pair

```
cd /home/bionet/bionet-labdevice # ensure you are in the app directory
ssh-keygen -t rsa -f mykey -N ""
```

# Setup

Copy the examples settings file:

```
cp settings.js.example settings.js
```

and edit to taste. 

You get the correct `hosthash` by running this with the wrong hosthash and the correct `hostname` and `port`.

# Permissions

If you're using a printer or webcam type device, ensure your user has write access to the device defined in the settings file. On ubuntu/debian systems you can do this using:

```
sudo usermod -a -G lp myUser # for printers
sudo usermod -a -G video myUser # for webcams
```

Where `myUser` is the username of the user that will be runnning this program. You will have to log out and log back in for the change to take effect.

Finally, ensure that the generated private key is only readable by root and the user that will be running the this program.

# Running

Then run:

```
npm start
```

# Testing

For printers you can test this client using `bin/print_server_test.js` from the [main bionet app](https://github.com/biobricks/bionet). 

# Setting up for production

The bionet-labdevice software should be installed under a non-root user account, so as root add a user account, e.g:

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
sudo cp production/bionet-labdevice.initd /etc/init.d/bionet-labdevice
chmod 755 /etc/init.d/bionet-labdevice
```

If you used a different username than `bionet` then you'll need to change the `runAsUser` line in the init.d file.

Test that it works. As root do:

```
systemctl daemon-reload # only if using systemd
/etc/init.d/bionet-labdevice start
```

If it's working make it auto-start on reboot:

```
update_rc.d bionet-labdevice defaults
```

# ToDo

* Make it start as root, read private key, then drop permissions

# License and Copyright

License is GPLv3

* Copyright 2016, 2017 BioBricks Foundation 

