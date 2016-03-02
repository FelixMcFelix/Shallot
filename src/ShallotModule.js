"use strict";

const RemoteCallable = require("conductor-chord").RemoteCallable,
	EventEmitter2 = require("eventemitter2").EventEmitter2,
	sha3 = require("js-sha3"),
	ID = require("conductor-chord").ID,
	pki = require("node-forge").pki,
	random = require("node-forge").random,
	cipher = require("node-forge").cipher,
	forgeUtil = require("node-forge").util,
	u = require("./UtilFunctions.js"),
	Session = require("./Session.js");

class ShallotModule extends RemoteCallable {
	static get defaultConfig () {
		return {
			routeLength: 3,
			callTimeout: 666,
			maxCallRetries: 3,
			rcCacheDuration: 5000
		};
	};

	constructor (chord, config) {
		super(chord, "shallot");

		this.config = u.mergeConfig(ShallotModule.defaultConfig, config);

		this._rcTimeout = this.config.callTimeout;
	    this._rcRetries = this.config.maxCallRetries;
	    this._rcCacheDuration = this.config.rcCacheDuration;

	    this._evts = new EventEmitter2({
	    	maxListeners: 20
	    });

	    this.keyStore = {};
	    this.sessions = {};
	    this.circuits = {};

		chord.registerModule(this);
	}

	get emit () {
		return this._evts.emit.bind(this._evts);
	}

	get on () {
		return this._evts.on.bind(this._evts);
	}

	get off () {
		return this._evts.off.bind(this._evts);
	}

	delegate (message) {
		if(super.delegate(message))
			return;

		switch (message.handler) {
			case "r":
				//RELAY
				this._parseRelay(message.data.params[0])
					.then(
						response => this.answer(message, response)
					)
					.catch(
						reason => this.error(message, reason)
					);
				break;
				break;
			case "b":
				//BUILD
				this._parseBuild(message.data.params[0])
					.then(
						response => this.answer(message, response)
					)
					.catch(
						reason => this.error(message, reason)
					);
				break;
			case "c":
				//CONTENT
				//TODO
				break;
		}
	}

	createRouteTo (id) {
		//Generate a route.
		//This is routeLength * randomIDs, + destination.
		let routeProms = [];

		for (let i = 0; i < this.config.routeLength; i++) {
			(i=>{
				let plannedId = new ID(
					forgeUtil.encode64(random.getBytesSync(this.chord.config.idWidth/8))
				);

				// Find what key our random id maps to.
				// Lookup its public key.
				// Fail if it does not exist.
				routeProms[i] = this.chord.node.findSuccessor(plannedId)
					.then(
						node => {return this._lookupKey(node.id);}
					);
			})(i)
		}

		routeProms[this.config.routeLength] = this.chord.node.findSuccessor(id)
			.then(
				node => {
					if (ID.compare(node.id, id) !== 0)
						return Promise.reject(`Destination node ${ID.coerceString(id)} could not be found!`);

					return this._lookupKey(id);
				}
			)

		// Now await all promise resolutions.
		// Afterwards, propagate the chain to build a session.

		return Promise.all(routeProms);
	}

	connectTo (id) {
		//First, get our route.
		return this.createRouteTo(id)
			.then(
				route => {
					//Generate an AES key for each hop.
					let aesKeys = [];
					for (let i =0; i < route.length; i++)
						aesKeys.push(random.getBytesSync(16));

					//Create the first circuitID
					let firstCirc = random.getBytesSync(8);

					let propagateLink = index => {
						//End recursive promise chain.
						if(index === routes.length)
							return Promise.resolve(new Session(this, route, aesKeys, firstCirc));

						//Package the aes key for each node along the chain.
						let internal = {
							k: route[index].encrypt(aesKeys[index])
						};

						//If sending to the first node, we have to send a full build message instead
						//of a relay.
						if (index===0) {
							internal.c = route[0].encrypt(firstCirc+ID.coerceString(this.chord.id));
							internal.v = this.chord.key.private.sign(
								sha3.sha3_224.hex(internal.k+internal.c)
							);
						} else {
							//We need to inform the end of the route about the next hop.
							//Encrypt this information just for it.
							internal.d = route[index-1].encrypt(ID.coerceString(route[index].id));

							//Now wrap with as many layers as we can, and put our circuit id
							//(secured, with the iv) in the message.
							let i = index,
								iv = random.getBytesSync(16),
								out = JSON.stringify(internal);

							while (i>=0) {
								out = ShallotModule.aes_encrypt(out, aesKeys[i], iv);
								i--;
							}

							internal = {
								d: out,
								s: route[0].encrypt(firstCirc+iv)
							}
						}

						return this.call(route[0].id, (index===0)?"b":"r", [internal])
							.then(() => {return propagateLink(index+1);})
					}

					//Begin propagation.
					return propagateLink(0);
				}
			);
	}

	_lookupKey (id) {
		let idStr = ID.coerceString(id);

		//If we have it, return it.
		if(this.keyStore[idStr])
			return Promise.resolve(this.keyStore[idStr]);
		else {
			//Perform network lookup.
			return new Promise ( (resolve, reject) => {
				this.chord.lookupItem(idStr)
					.then( pubKey => {
						//If it wasn't in the network, reject the original call.
						//Also reject if the pubkey does not match the target.
						if (pubKey===null)
							reject("[Shallot] - couldn't find pubKey for "+idStr);
						else {
							let hash = sha3["sha3_"+this.chord.config.idWidth].buffer(pubKey),
								hashStr = ID.coerceString(new ID(hash));

							if (ID.compare(hashStr, id)!==0) {
								reject("[Shallot] - mismatch of obtained pubKey for "+idStr);
							} else {
								//Build a new item for future lookups, and then resolve the original call.
								let item = {
									id,
									pubKey,
									cryptor: pki.publicKeyFromPem(pubKey),
									encrypt (msg) {
										return this.cryptor.encrypt(msg, "RSA-OAEP");
									},
									verify (digest, signature) {
										return this.cryptor.verify(digest, signature, "RSA-OAEP");
									}
								};

								this.keyStore[idStr] = item;
								resolve(item);
							}
						}
					} )
			} )
		}
	}

	_parseRelay (content) {
		//PACKET FORMAT
		//d: encrypted data for us to decode.
		//s: secured circuit

		//Can contain:
		//	relay - data cannot be JSON parsed, circuit has a next hop.
		//	build - data can be parsed, we must take the d field and add
		//			c and v fields (circuit+this id, signature).
		//			e: 1 => we are the end node
		//	content - data can be JSON parsed - ouput at session attached
		//			to circuit.

	}

	_parseBuild (content) {
		//PACKET FORMAT
		//k: our aes key for this circuit segment
		//c: encypted circuit code, + last hop's ID
		//v: signature, signed by last hop.
	}

	static aes_encrypt (data, aesKey, iv) {
		let cipherObj = cipher.createCipher('AES-CBC', aesKey);

		cipherObj.start({
			iv,
			additionalData: 'binary-encoded string'
		});

		cipherObj.update(forgeUtil.createBuffer(data));
		cipherObj.finish();

		return {iv, data: cipherObj.output.data, tag: cipherObj.mode.tag.data};
	}

	static aes_decrypt (cipherText, aesKey, iv) {
		let decipher = cipher.createDecipher('AES-CBC', aesKey);

		decipher.start({
			iv,
			additionalData: 'binary-encoded string'
		});

		decipher.update(forgeUtil.createBuffer(cipherText));
		let success = decipher.finish();

		return (success) ? decipher.output.data : null;
	}
}

module.exports = ShallotModule;