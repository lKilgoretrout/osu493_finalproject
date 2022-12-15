require('dotenv').config()

const express = require('express');
const app = express();

const router = express.Router();

const boats = require('./boats');
const loads = require('./loads');

//const router = module.exports = require('express').Router();
app.use('/boats', boats);
app.use('/loads', loads);


const json2html = require('json-to-html');

const {Datastore} = require('@google-cloud/datastore');
const handlebars = require('express-handlebars').create({defaultLayout:'main'});
const bodyParser = require('body-parser');
const request = require('request');
const axios = require('axios');

const datastore = new Datastore();

const jwt = require('express-jwt');
const jwt_decode = require('jwt-decode');
const jwksRsa = require('jwks-rsa');
const logger = require('morgan');

app.engine('handlebars', handlebars.engine);
app.set('view engine', 'handlebars');

const path = require('path')
app.use('/', express.static(path.join(__dirname, 'public')))


const BOAT          = "Boat";
const USER          = "User";
const LOAD          = "Load";
var   ACCESS_TOKEN  = null;

/*{         USER
    "username"    :  friend@hello.com            # req.user.email / POST /login : req.body.username
    "user_id   :  "auth0|5eb70257",              # req.user.sub
    "createdAt :  "Sun Dec 17 1995 03:24:00 GMT" # new Date();
}*/

/////////////////////////////////////////////////////////////////////////////////////////
// auth0 code from: https://auth0.com/docs/quickstart/webapp/express#configure-auth0
////////////////////////////////////////////////////////////////////////////////////////
const { auth, requiresAuth } = require('express-openid-connect');
// 'requiresAuth' middleware  checks user authentication for privileged routes
// const { requiresAuth } = require('express-openid-connect');

const config = {
   authorizationParams: {
      response_type: 'code', // This requires you to provide a client secret
      audience: 'https://baucusr-final-v2.uw.r.appspot.com/',  //'https://api.example.com/products',
	  prompt: 'consent',
      scope: 'openid profile email',
    },
  authRequired: false,
  auth0Logout: true,
  baseURL: 'https://baucusr-final-v2.uw.r.appspot.com/',
  clientID: process.env.CLIENT_ID,
  issuerBaseURL: 'https://baucusr-final.us.auth0.com', 
  secret: process.env.SECRET
};

// auth router attaches /login, /logout, and /callback routes to app.get('/') baseURL: https://baucusr-hw7-368604.uw.r.appspot.com/
app.use(auth(config));
app.use(bodyParser.json());
app.use(logger('dev'));

function fromDatastore(item){
    item.id = item[Datastore.KEY].id;
    return item;
}


const checkJwt = jwt({
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: "https://baucusr-final.us.auth0.com/.well-known/jwks.json"
    }),
  
    // Validate the audience and the issuer.
	audience: 'https://baucusr-final-v2.uw.r.appspot.com/',
    issuer: "https://baucusr-final.us.auth0.com/",
    algorithms: ['RS256']    //,
	//credentialsRequired : false
  });

//app.use(checkJwt);
/* ------------- Begin BOAT Model Functions ------------- */



// create User in database (after POST for jwt), if already in database --> RETURN
async function post_user(user_id, username) {
    console.log(`post_user(${user_id}, ${username})`);
    var key = datastore.key(USER);
    
    // check if User in datastore:
    const query = datastore
	    .createQuery(USER)
	    .filter('user_id', user_id);
	var matches = await datastore.runQuery(query);
	//console.log("matches: " + JSON.stringify(matches, " ", 2));
	
	//console.log("matches[0].length: " + matches[0].length);
	matches =  (matches[0].length === 0) ? null : matches[0];
    
    // user already in datastore
    if (matches !== null) return null;
    
    const new_user = {
        "username"  : username, 
        "user_id"   : user_id,
        "createdAt" : new Date()
    };
    return await datastore.save({"key":key, "data":new_user})
    console.log("post_user: successfull!");
	console.log(JSON.stringify(new_user, " ", 2));
	return new_user;
    
}

app.get('/authorized', function (req, res) {
    res.send('Secured Resource');
});



// welcome page
// GET /login
app.get('/', async function(req, res) {
	
    var user_id  = (req.oidc.isAuthenticated()) ? req.oidc.user.sub   : null;
    var username = (req.oidc.isAuthenticated()) ? req.oidc.user.email : null;
	if (username !== null)
		var addedUser = await post_user(user_id, username)
	
	var data = { 
        "user_id"        : user_id, //req.oidc.user.sub,
		"username"       : username, //req.oidc.user.email, //JSON.stringify(req.oidc.user, " ", 2),
	    "isAuthenticated": req.oidc.isAuthenticated(),
		"ACCESS_TOKEN"   : JSON.stringify(req.oidc.accessToken)// ACCESS_TOKEN
	};
	
	/*
	console.log("-------------------------------------");
	let { token_type, access_token } = req.oidc.accessToken;
	console.log(JSON.stringify(access_token, " ", 2));
	*/
	res.render('welcome', data)
});

// GET /users  --> UNPROTECTED , return all registered users
app.get('/users', async function(req, res) {
    
    console.log("GET /users");
    var key = datastore.key(USER);
    
    // check if User in datastore:
    const erbuddy = datastore
	    .createQuery(USER)
        .order('createdAt');
	var matches = await datastore.runQuery(erbuddy);
    
    res.status(200).json(matches);
});

// redirect after logging in
app.get('/callback', async (req, res) => {
	console.log(`/callback request object: ${JSON.stringify(req, " ", 2)}`);
	var data = { 
		// req.isAuthenticated is provided from the auth router
		"obj"            : res,
	    "isAuthenticated": req.oidc.isAuthenticated(),
		"ACCESS_TOKEN"   : ACCESS_TOKEN
	};
	
	console.log("--------------------------------------");
	
	res.render('welcome', data)
    //res.send(req.oidc.isAuthenticated() ? 'Logged in' : 'Logged out')
});


	


// Listen to the App Engine-specified port, or 8080 otherwise
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});

