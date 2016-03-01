"use strict";

const RemoteCallable = require("conductor-chord").RemoteCallable,
	EventEmitter2 = require("eventemitter2").EventEmitter2,
	sha3 = require("js-sha3"),
	ID = require("conductor-chord").ID,
	pki = require("node-forge").pki,
	random = require("node-forge").random,
	cipher = require("node-forge").cipher,
	forgeUtil = require("node-forge").util,
	u = require("./UtilFunctions.js");

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
}

module.exports = ShallotModule;