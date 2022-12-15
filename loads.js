require('dotenv').config()

const express     = require('express');
const router      = express.Router();
const app         = express();

const json2html   = require('json-to-html');

const {Datastore} = require('@google-cloud/datastore');
const handlebars  = require('express-handlebars').create({defaultLayout:'main'});
const bodyParser  = require('body-parser');
const request     = require('request');
const axios       = require('axios');

const datastore   = new Datastore();

const jwt         = require('express-jwt');
const jwt_decode  = require('jwt-decode');
const jwksRsa     = require('jwks-rsa');
const logger      = require('morgan');

app.engine('handlebars', handlebars.engine);
app.set('view engine', 'handlebars');

const path = require('path')
app.use('/', express.static(path.join(__dirname, 'public')))


const BOAT          = "Boat";
const USER          = "User";
const LOAD          = "Load";
var   ACCESS_TOKEN  = null;

/*{        LOAD
	"id"       : 123,               # Int. Automatically generated by Datastore
	"item"     : "commercial fish", # String. Description of the load
	"weight"   : 420                # Int. Weight of load in pounds
	"volume"   : 28,                # Int. Volume of load in cubic feet
	"carrier"  : { 
		"name": "Bubba Gump", 
		"id": 5723707007827968,
		"self": "http://localhost:8080/boats/5723707007827968"
	},
	"self":"https://appspot.com/laodss/123" # GET location of resource.
}*/


const config = {
  authRequired: false,
  auth0Logout: true,
  baseURL: 'https://baucusr-final-v2.uw.r.appspot.com/',
  clientID: process.env.CLIENT_ID,
  issuerBaseURL:`https://${process.env.DOMAIN}`,
  secret: process.env.SECRET
};

// auth router attaches /login, /logout, and /callback routes to app.get('/') baseURL: https://baucusr-hw7-368604.uw.r.appspot.com/
//router.use(auth(config));
router.use(bodyParser.json());
router.use(logger('dev'));

function fromDatastore(item){
    item.id = item[Datastore.KEY].id;
    return item;
}


/** helper function for DELETE loads/:load_id
* deletes a load from a boat 
**/
async function replaceBoatLoads(boat_id, load_data) {
	const boatkey = datastore.key([BOAT, parseInt(boat_id, 10)]);
	var entity = await datastore.get(boatkey);
	entity[0].loads = load_data;
	return await datastore.update(entity);
}

/** update load with load_id(int) with new properties (one or more): 
* name(str), type(str) and length(int) and owner(str)
 * helper function for the PATCH and PUT /loads/:load_id route
 **/
async function updateLoad(load_id, item, weight, volume) {
	//console.log("Checkpoint 1 " );
	const loadkey     = datastore.key([LOAD, parseInt(load_id, 10)]);
    var   loadEntity  = await datastore.get(loadkey);
	
	//console.log("loadEntity: " + JSON.stringify(loadEntity, " ", 2));
	
	// No entity found ? --> return null, else update properties with args values
	if   (loadEntity[0] === undefined || loadEntity[0] === null) { return null; }
    else {
		loadEntity[0]["item"]   = (item   === undefined) ? loadEntity[0].item   : item;
		loadEntity[0]["weight"] = (weight === undefined) ? loadEntity[0].weight : weight;
		loadEntity[0]["volume"] = (volume === undefined) ? loadEntity[0].volume : volume;
	}	
	//console.log("Checkpoint 2 " );
	// update the load:
	await datastore.update(loadEntity);
	
	//console.log("Checkpoint 3 " );
	
	// if load is on a boat --> update that boat's load
	let id_of_boat_to_update = null;
	if (loadEntity[0].carrier !== null) { 
		id_of_boat_to_update =  loadEntity[0].carrier.id; 
		//console.log("id_of_boat_to_update: " + id_of_boat_to_update);
		const boatkey  = datastore.key([BOAT, parseInt(id_of_boat_to_update, 10)]);
		var boatEntity = await datastore.get(boatkey);
		
		//console.log("boatEntity: " + JSON.stringify(boatEntity, " ", 2));
		
		
		
		for (i=0; i<boatEntity[0].loads.length; i++) {
			if (boatEntity[0].loads[i].id     === load_id) {
				boatEntity[0].loads[i].item   = (arguments["1"] === undefined) ? boatEntity[0].loads[i].item   : item;
				boatEntity[0].loads[i].weight = (arguments["2"] === undefined) ? boatEntity[0].loads[i].weight : weight;
				boatEntity[0].loads[i].volume = (arguments["3"] === undefined) ? boatEntity[0].loads[i].volume : volume;
				break;
			}
		}
		
		await datastore.update(boatEntity);	
	}
	//console.log("Checkpoint 4 " );
	return loadEntity[0];
};





// delete load by load_id
async function deleteLoad(load_id) {
    const key = datastore.key([LOAD, parseInt(load_id, 10)]);
	var entity = await datastore.get(key);
	if (entity[0] === undefined || entity[0] === null) {
			console.log(`deleteLoad error: load_id:${load_id} doesn't exist`);
            return null;
	} else { 
	    await datastore.delete(key); 
		return;
	}
}
	

// calls a query on KIND, returns INT of count for that kind
async function getEntityCount(kind) {
    // get count of Boats (to add to response)
    const countQuery = datastore.createQuery(kind);
    var countResults = await datastore.runQuery(countQuery);
    var total_kind_count = countResults[0].length;
    console.log(`total_${kind}_count: ${total_kind_count}`);
    
    return total_kind_count;
}

async function get_loads(req, load_count){
    var results = {};
    results["total_load_count"] = load_count;
    var q = datastore.createQuery(LOAD).limit(5);
    
    if (Object.keys(req.query).includes("cursor")) {
        q = q.start(req.query.cursor);
    }
	return datastore.runQuery(q).then( (entities) => {
		console.log("loads: " + JSON.stringify(entities[0], " ", 2));
		results["loads"] = entities[0].map(fromDatastore);
		
		if(entities[1].moreResults !== datastore.NO_MORE_RESULTS ){
			results.next = req.protocol + "://" + req.get("host") + req.baseUrl + 
						   "?cursor=" + entities[1].endCursor;
		}
		return results;
	});
    
}


async function getLoad(load_id) {
    const key = datastore.key([LOAD, parseInt(load_id, 10)]);
    const load = await datastore.get(key);
	return load[0];
}    

async function getBoat(boat_id) {
    const key = datastore.key([BOAT, parseInt(boat_id, 10)]);
	var boat = await datastore.get(key);
	return boat[0];
}

// no input parameter validation 
async function post_load(req, item, weight, volume) {
    console.log(`post_load(${item}, ${weight}, ${volume})`);
    var key = datastore.key(LOAD);
    const new_load = {
        "id"        : null,
        "item"      : item,
        "weight"    : weight, 
        "volume"    : volume,
		"carrier"   : null,	
        "self"      : null
    };
    return datastore.save({"key":key, "data":new_load})
    .then(() => {
        new_load.id = key.id;
        const self   = req.protocol + "://" + req.get("host") + req.baseUrl + "/" + key.id;
        new_load.self = self;
        
        return  datastore.save({"key":key, "data":new_load});
    })
    .then(() => {
        return new_load;
    })
}

//////////////////////////////////////////////////////////////////////////////
// ROUTES
//////////////////////////////////////////////////////////////////////////////

// DEL a load completely (and remove from loads of boat, if applicable)
// DELETE /loads/:load_id
router.delete('/:load_id', async function(req, res) {
	
	//console.log("checkpoint 1!");
	// check load exists
	try {
		console.log("req.params.load_id: " + req.params.load_id);
		var load = await getLoad(req.params.load_id);
		
		console.log("load: " + JSON.stringify(load, " ", 2));
		
		// no such load --> 404
		if (load === undefined || load === null )  { 
		    return res.status(404).json(
				{'error' : `DELETE ERROR: load_id ${req.params.load_id} doesn't exist`}
			);
		}
			
	} catch (error) { console.log("verify check load exist block messed up!"); }
		
	try {
		//console.log("checkpoint 2!");
		//if load has carrier, delete load from corresponding boat
		if (load.carrier !== null) {
			//console.log("load.carrier: " + JSON.stringify(load.carrier, " ", 2));
			
			var boat = await getBoat(load.carrier.id);
			//console.log("checkpoint 3: boat: " + JSON.stringify(boat, " ", 2));
			var loads_on_boat = boat.loads;
			
			// lifted the folowing splice() tidbit from stackoverflow:
			// https://stackoverflow.com/questions/51724323/javascript-removing-object-from-array-by-key-value
			// get the index of the object in loads array with key=load_id
			const index = loads_on_boat.findIndex(load => load.id === req.params.load_id.toString());
			//console.log("index: " + index);
			
			//remove load from boat.loads[] : array.splice (startIndex, deleteCount);
			loads_on_boat.splice(index,1);
			//console.log("after splice: loads_on_boat: " + JSON.stringify(loads_on_boat, " ", 2))		
			
			// remove load from loads[] on boat corresponding to load.carrier_id
			await replaceBoatLoads(boat.id, loads_on_boat);
		}
		// now delete the load itself:
		await deleteLoad(load.id);
		console.log(`DELETE /loads/${req.params.load_id} successful!`);
		return res.status(204).send(`DELETE /loads/${load.id} successful!`);
		
	} catch {
		return res.status(500).json({"error": "DELETE /load/:load_id error in deleting corresponding loads on boat"});
	}
});	

// GET /loads
router.get('/', async function(req, res) {
	try {
		// Accept header does not include 'application/json'
		if (req.get('accept') !== 'application/json' ) {
		    return res.status(406).json({'error':'NOT ACCEPTABLE: Server only sends application/json data.'})
	    }
		console.log(`GET /loads`);
		const load_count = await getEntityCount(LOAD);
		const loads = await get_loads(req, load_count)
		//var purdy = JSON.stringify(loads, " ", 2);	
		return res.status(200).json(loads);		
	
	} catch { console.log("get_loads() messed up!"); }
});	

// GET /loads/:load_id  --> get load by id
router.get('/:load_id', async function(req, res) {
	try {
		var load = await getLoad(req.params.load_id);
		if (!load) {
			console.log(`Failed GET /loads/${req.params.load_id}`);
			return res.status(404).json({'error': `No load exists with id=${req.params.load_id}`});
		
		// Accept header does not include 'application/json'
		} else if (req.get('accept') !== 'application/json' ) {
			return res.status(406).json(
			    {'error':'NOT ACCEPTABLE: Server only sends application/json data.'}
			)
		}
		console.log(`GET /loads/${req.params.load_id}`);
		return res.status(200).json(load);
	
	} catch { console.log(`GET /loads/${req.params.load_id} has messed up!`); }
	
});

// POST /loads  ( create load)
// req.body = { "item": "potatoes", "weight":420, "volume": 42.0 }
router.post('/',  async function(req, res) {
    
    // content-type must equal application/json OR --> 415
    if (req.get('content-type') !== 'application/json') {
        return res.status(415).json({'error':'Server only receives application/json data.'})
    }
	else if (req.get('accept') !== 'application/json' ) {
		return res.status(406).json({'error':'NOT ACCEPTABLE: Server only sends application/json data.'})
	}
    let new_load = await post_load(req, req.body.item, req.body.weight, req.body.volume);
	//res.location(req.protocol + "://" + req.get('host') + req.baseUrl + '/' + new_load.id);
	return res.status(201).json(new_load);
});		


// modify a load with fewer than 3 attributes, update corresponding boats (if applicable)
// patch /loads/:load_id
router.patch('/:load_id', async function(req, res) {
	
	//console.log("checkpoint 1!");
	// check load exists
	try {
		//console.log("req.params.load_id: " + req.params.load_id);
		var load = await getLoad(req.params.load_id);
		
		//console.log("load: " + JSON.stringify(load, " ", 2));
		
		// no such load --> 404
		if (load === undefined || load === null )  { 
		    return res.status(404).json(
				{'error' : `PATCH ERROR: load_id ${req.params.load_id} doesn't exist`}
			);
		} else if (req.get('accept') !== 'application/json' ) {
			return res.status(406).json({'error':'NOT ACCEPTABLE: Server only sends application/json data.'})
		}
	} catch (error) { 
		res.status(500).json({"error": "PATCH error: check load exists messed up" }); 
	}
	
	// handle the patch
	try {
		var load_id = req.params.load_id;
		var item    = req.body.item;
		var weight  = req.body.weight;
		var volume  = req.body.volume;
		
		var load    = await updateLoad(load_id, item, weight, volume);
		//console.log("Checkpoint 5 " );
		return res.status(201).json(load);
	} catch { return res.status(500).json({"error": "updateLoad messed up"}); }
});

// modify all attributes of a load;  update corresponding boats
// put /loads/:load_id
router.put('/:load_id', async function(req, res) {
	
	//console.log("checkpoint 1!");
	// check load exists
	try {
		console.log("req.params.load_id: " + req.params.load_id);
		var load = await getLoad(req.params.load_id);
		
		console.log("load: " + JSON.stringify(load, " ", 2));
		
		// no such load --> 404
		if (load === undefined || load === null )  { 
		    return res.status(404).json(
				{'error' : `put ERROR: load_id ${req.params.load_id} doesn't exist`}
			);
		} else if (req.get('accept') !== 'application/json' ) {
			return res.status(406).json({'error':'NOT ACCEPTABLE: Server only sends application/json data.'})
		}
	} catch (error) { 
		return res.status(500).json({"error": "put error: check load exists messed up" }); 
	}
	
	// handle the put
	try {
		var load_id = req.params.load_id;
		var item    = req.body.item;
		var weight  = req.body.weight;
		var volume  = req.body.volume;
		
		var load    = await updateLoad(load_id, item, weight, volume);
		//console.log("Checkpoint 5 " );
		return res.status(201).json(load);
	} catch { return res.status(500).json({"error": "updateLoad messed up"}); }
}
	
	
	
	
	
	
	
	
	
);

// unallowed method on route:
// DEL /loads--> send 406, set Allow header
router.delete('/', function (req, res){
    res.set('Allow', 'GET, POST');
	console.log("405 DELETE Error: you can't just delete all the boats, GOSH!");
    return res.status(405).json({"405 DELETE Error": "you can't just delete all the loads, GOSH!"});
});

module.exports = router;