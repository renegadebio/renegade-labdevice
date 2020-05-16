
A small node app that is meant to run on a single-board computer and securely connects a physical lab device to a remote renegade-lims node (which could be physically in the lab or not).

Specifically, the following device-types are supported:

* Plain USB webcams (for scanning DataMatrix codes only)
* USB thermal label printers

For printers this allows printing from the renegade-lims web app to in-lab thermal printers. 

For scanners this makes it possible to show scan results in the renegade-lims web app when scanning on in-lab barcode scanners.

# Supported barcode scanners

* Any USB scanner that shows up as a USB keyboard (e.g. Kercan KR-201)
* Any USB scanner that shows up as a webcam (e.g. SUMLUNG scanners from alibaba)

# Supported label printers

* Dymo LabelWriter 450 Turbo
* Dymo LabelWriter 4XL
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
nvm install --lts
```

Now clone this repository into the user's homedir:

```
cd ~/
git clone https://github.com/Juul/renegade-labdevice
```

To install the node dependencies do:

```
cd renegade-labdevice/
npm install
```

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

If you're using this with a USB barcode scanner that pretends to be a USB keyboard (most hand-held type USB barcode scanners are like this) then you will need:

```
sudo apt install build-essential git libusb-1.0-0 libusb-1.0-0-dev
```

and you will need to manually install the npm `node-hid` package by running this command from within this directory:

```
npm install node-hid
```

# Setup

Copy the examples settings file:

```
cp settings.js.example settings.js
```

## TLS certificates

```
./scripts/gen_cert.sh
```

If you are using this locally on the same machine as `renegade-lims` then the hostname should probably just be `localhost`.

Now copy the server's cert to `tls/server-cert.pem` and copy `tls/client-cert.pem` to the appropriate place on the server.

and edit to taste. 

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

or

```
./bin/cmd.js
```

You can run in insecure mode, where it won't bother validating the server certificate, using:

```
./bin/cmd.js --insecure
```

# Testing

For printers you can test this client using `bin/print_server_test.js` from the [bionet app](https://github.com/biobricks/bionet). 

# Printing multiple copies

It seems that printing multiple copies is currently broken in the DYMO driver (or at least I couldn't get it to work). Setting `supportsCopies: false` in `settings.js` is a workaround but that puts a 3-4 second pause between each printed copy.

A better fix is to edit your printer's `.ppd` file (after you've installed the printer) which is probably in a path like:

```
/etc/cups/ppd/DYMO-LabelWriter-450-Turbo.ppd
```

and change the line:

```
*cupsManualCopies: False
```

to:

```
*cupsManualCopies: True
```

Then restart CUPS:

```
sudo systemctl restart cups
```

Now you can set `supportsCopies: true` in `settings.js`.

# Useful CUPS commands

To list all installed printers:

```
lpstat -v
```

List available paper sizes and options:

```
lpoptions -d DYMO-LabelWriter-450-Turbo -l
```

Print with custom paper size:

```
lpr -P DYMO-LabelWriter-450-Turbo -o media=Custom.20x39mm examples/example.png
```

To list all currently connected USB printers (not limited to installed printers):

```
lpinfo -v|grep "usb://"
```

To install a printer do e.g.:

```
sudo lpadmin -p "LabelWriter-450-turbo" -E -v usb://DYMO/LabelWriter%20450%20Turbo?serial=13011612335742 -m lw450t.ppd
```

To list all printer drivers (for the `-m` argument in `lpadmin -p`):

```
lpinfo -m
```

To remove a printer then do e.g:

```
sudo lpadmin -x LabelWriter-450-turbo
```

# Setting up for production

The renegade-labdevice software should be installed under a non-root user account, so as root add a user account, e.g:

```
adduser renegade
```

Then log in as that user, ensure you are in the user's homedir and follow the instructions at the top of the README for installing this application and its dependencies. 

Now for making the app auto start when the computer boots and auto restart when it crashes.

First install the psy process monitor globally:

```
npm install -g psy
```

Then as root:

```
sudo cp production/renegade-labdevice.initd /etc/init.d/renegade-labdevice
chmod 755 /etc/init.d/renegade-labdevice
```

If you used a different username than `renegade` then you'll need to change the `runAsUser` line in the init.d file.

Test that it works. As root do:

```
systemctl daemon-reload # only if using systemd
/etc/init.d/renegade-labdevice start
```

If it's working make it auto-start on reboot:

```
update-rc.d renegade-labdevice defaults
```

# Notes on label sizes

## Diversified BioTech WetGrip [GRDT-5000] (https://www.divbio.com/product/grdt-5000)

These are 2.00" x 0.25" labels for 96-well plates. They turn black when exposed to 70% isopropanol (still need to test with ethanol).

A 1020x440 pixel image printed with `lpr -o media=Custom.51x22mm` will have its sides and bottom aligned with the label. The top ~49 pixels will not be printed.

## Diversified BioTech Xylene Resistant [RVTH-3000](https://www.divbio.com/product/rvth-3000)

These are a bit large for normal 2 ml cryotubes but they can work. They are resistant (but not immune) to 70% ethanol. Much less so for 70% isopropanol.

A 560x1083 pixel image printed with `lpr -o media=Custom.20x39mm` will fill the label.

# ToDo

* Implement buffer to avoid folks printing too fast
* Report [USB connection status](https://unix.stackexchange.com/questions/216223/how-to-make-cups-show-a-usb-printer-as-disabled-when-it-is-disconnected)
* Hook BLE scanning into the RPC system
* Implement remote software update

# License and Copyright

License is GPLv3

* Copyright 2020 Marc Juul Christoffersen
* Copyright 2016, 2017, 2018 BioBricks Foundation


