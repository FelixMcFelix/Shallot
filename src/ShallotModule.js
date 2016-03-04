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
						if(index === routes.length) {
							let data = {
								f: ID.coerceString(this.chord.id)
							};

							return this._onionRelayBegin(aesKeys, route[0].id, circ, data)
								.then(()=> {
									return Promise.resolve(new Session(this, route, aesKeys, firstCirc));
								})
						}

						//Package the aes key for each node along the chain.
						let internal = {
							k: route[index].encrypt(aesKeys[index])
						};

						//Our promise for both paths.
						let a;

						//If sending to the first node, we have to send a full build message instead
						//of a relay.
						if (index===0) {
							internal.c = route[0].encrypt(firstCirc+ID.coerceString(this.chord.id));
							internal.v = this.chord.key.private.sign(
								sha3.sha3_224.hex(internal.k+internal.c)
							);

							a = this._sendBuild(route[0].id, internal);
						} else {
							//We need to inform the end of the route about the next hop.
							//Encrypt this information just for it.
							internal.d = route[index-1].encrypt(ID.coerceString(route[index].id));

							//Now wrap with as many layers as we can, and put our circuit id
							//(secured, with the iv) in the message.
							a = this._onionRelayBegin(aesKeys, route[0].id, firstCirc, internal, index-1);
						}

						return a.then(() => {return propagateLink(index+1);})
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

	_sendOnion (aesKeys, firstHop, circ, data, index) {
		let i = (index===undefined) ? aesKeys.length-1 : index,
			iv = random.getBytesSync(16),
			out = JSON.stringify(data);

		while (i>=0) {
			out = ShallotModule.aes_encrypt(out, aesKeys[i], iv);
			i--;
		}

		let internal = {
			d: out,
			s: route[0].encrypt(circ+iv)
		};

		return this.call(firstHop, "r", [internal]);
	}

	_sendBuild (firstHop, data) {
		return this.call(firstHop, "b", [data]);
	}

	_parseRelay (content) {
		//PACKET FORMAT
		//d: encrypted data for us to decode.
		//s: secured circuit

		//Can contain:
		//	relay - data cannot be JSON parsed, circuit has a next hop.
		//	build - data can be parsed, we must take the d field and add
		//			c and v fields (circuit+this id, signature).
		//	finish - JSON message dictating that the given circuit is an exit point.
		//			contains f: entry point's id.
		//	content - data can be JSON parsed - ouput at session attached
		//			to circuit.

		return new Promise( (resolve, reject) => {
			//Parse "s" - decrypt, then first 8 bytes are circuit, next 16 are iv for AES.
			let decS = this.chord.key.private.decrypt(content.s),
				circ = decS.substr(0, 8),
				iv = decS.substr(8, 16);

			//We can now decrypt d.
			let packetRaw = aes_decrypt(content.d, this.circuits[circ].aes, iv),
				packet = ShallotModule.determinePacket(packetRaw);
		} );
	}

	_parseBuild (content) {
		//PACKET FORMAT
		//k: our aes key for this circuit segment
		//c: pub encypted circuit code, + last hop's ID
		//v: signature, signed by last hop.

		//First, read in AES key, circuit and last hop.
		return new Promise( (resolve, reject) => {
			let aesKey = this.chord.key.private.decrypt(content.k),
				decC = this.chord.key.private.decrypt(content.c),
				circ = decC.substr(0,8),
				lastHopId = decC.slice(8),
				verHash = sha3.sha3_224.hex(content.k+content.c);

			//Now, verify the hash to ensure origin is correct.
			this._lookupKey(lastHopId)
				.then(
					key => {
						let ver = key.verify(verHash, content.v);

						if (!ver)
							reject("Could not verify build packet!");

						//Now, place the circuit in the internal tables.
						this.circuits[circ] = {
							aes: aesKey,
							lastHop: lastHopId,
							nextHop: null
						}

						resolve(true);
					},

					err => reject(err)
				)
		} );
	}

	static determinePacket (packetRaw) {
		//Can contain:
		//	relay - data cannot be JSON parsed, circuit has a next hop.
		//	build - data can be parsed, has d,k.
		//	finish - JSON message, has f.
		//	content - data can be JSON parsed, has c

		let out = {
			type: null,
			data: null
		},
		inter;

		try {
			inter = JSON.parse(packetRaw);
		} catch (e) {
			out.type = "relay";
			out.data = packetRaw;

			return out;
		}

		if (inter.d !== undefined && inter.k !== undefined)
			out.type = "build"
		else if (inter.f !== undefined)
			out.type = "finish"
		else if (inter.c !== undefined)
			out.type = "content"
		else
			throw new Error("Illegal packet content: "+packetRaw);

		out.data = inter;

		return out;
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