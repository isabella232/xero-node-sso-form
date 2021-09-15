# Xero Single Sign Up to Lead (SSU to Lead)
This app shows a user authentication strategy using [OAuth 2.0](https://oauth.net/2/) and [OpenID Connect](https://openid.net/connect/). Sign up to lead is an alternative to SSO sign up / sign in for products which can not be instantly deployed.  It is not the preferred integration method, but it is acceptable for products that require an extensive pre-sales / onboarding process or deal with physical or non-cloud based products.

This sample project is an implementation of the OAuth 2, [Modified Sign Up with Xero](https://developer.xero.com/documentation/guides/oauth2/sign-up#modified-flow) flow which is documentated in the Xero developer portal.

<!-- # <a href="https://xero-ssu.herokuapp.com" target="_blank">Hosted Demo of SSU to Lead</a> -->

![Xero Sign Up to Lead Demo Application](https://raw.githubusercontent.com/XeroAPI/xero-node-ssu-form/main/public/images/ssu-demo-screenshot.png)

---
# Code Walkthrough
The following steps are the core pieces of code you will need to implement this in any application.
### 1. Scopes & Authorization URL
### 2. Callback URL
### 3. `id_token` validation & decoding
### 4. Create user
### 5. Pre-populate sign up form to capture additional details / context

---
#### 1. **Scopes & Authorization URL**

This will look something like:
> `https://login.xero.com/identity/connect/authorize?client_id=<CLIENT_ID>&scope=openid profile email&response_type=code&redirect_uri=<CALLBACK_URI>`

* **openid profile email**: These are Xero's supported OIDC scopes. They will return a JWT called `id_token` which you can Base64Url decode to utilize the user's information

Note: These scopes to do NOT authorise API access, they ONLY request identity details for the user.

---
#### 2. **Callback URL**

In the same route that matches the authorization url and the app settings in your [Xero App Dashboard](https://developer.xero.com/myapps/), you will need to catch the authorization flow temporary code and exchange for `token_set`

In this example we are using the [xero-node SDK](https://github.com/XeroAPI/xero-node) which has a helper to do this exchange.
```javascript
const tokenSet = await xero.apiCallback(responseUrl);
```

---
#### 3. **`id_token` validation and decoding**

The SDK also handles this under the hood with an OIDC Certified library called [node-openid-client ](https://openid.net/developers/certified/) which does a sequence of cryptographic checks to ensure the token is valid and has not been tampered with.
```javascript
await this.validateIdToken(tokenset, checks.nonce, 'authorization', checks.max_age, checks.state);
```
Once validated we can decode the JWT and access the user data within for use in our user management & login code.
```javascript
const decodedIdToken = jwtDecode(tokenSet.id_token)

const userParams = {
  firstName: decodedIdToken.given_name,
  lastName: decodedIdToken.family_name,
  email: decodedIdToken.email,
  xero_userid: decodedIdToken.xero_userid,
  decoded_id_token: decodedIdToken,
  token_set: tokenSet,
  ...
}
```

---
#### 4. **Create User**

Now that we have verified user data out of our `id_token` we can lookup to see if that user already exists or not. If they do, we update any incoming data like a name change, and if not we create a new user record in our database and log them, setting a secure signed cookie variable that will persist for the sign up period.
```javascript
const user = await User.findOne({where: { email: decodedIdToken.email }})

if (user) {
  await user.update(userParams).then(updatedRecord => {
    console.log(`UPDATED user ${JSON.stringify(updatedRecord.email,null,2)}`)
    return updatedRecord
  })
} else {
  await User.create(userParams).then(createdRecord => {
    console.log(`CREATED user ${JSON.stringify(createdRecord.email,null,2)}`)
    return createdRecord
  })
}
res.cookie('recentSession', recentSession, { signed: true, maxAge: 1 * 60 * 60 * 1000 }) // 1 hour
```

---
#### 5. **Pre-populated Sign Up Form**

Now that the user has authenticated with Xero's identity service, you can pre-populate a sign up form in order to collect additional details which Xero's identity service & API do not provide.

Details provided in the form are saved against the user in the database.

#### 6. **Choose your own adventure**
While this is a fully working example, you'll likely want to throw in another step here.  The sign up data is saved to the database.  You'll likely want to send this data to a CRM, workflow tool, or just email it to the sales team.  Either way, that should be easy enough to add.

### Running app
To contribute or extend to this repo get running locally through these steps:

1. Install postgres

On mac I recommend using [homebrew](https://wiki.postgresql.org/wiki/Homebrew) to install. For windows or Ubuntu please follow [postgres' guides](https://www.postgresql.org/download/).
> Helpful guides if you get stuck:
* [MacOS Install](https://www.robinwieruch.de/postgres-sql-macos-setup) to set that up

2) Install sequelize-cli
```bash
npm install --save-dev sequelize-cli
```
3) Create a Postgres user and database
> To setup your initial PG user I reccomend reading https://medium.com/coding-blocks/creating-user-database-and-adding-access-on-postgresql-8bfcd2f4a91e

### Configure with your XeroAPI & Database credentials
1) Login to Xero Developer center https://developer.xero.com/myapps and create a new API application
2) Create a `.env` file in the root of your project
3) Replace the variables in .env
```
CLIENT_ID=...
CLIENT_SECRET=...
REDIRECT_URI=...
DATABASE=...
DATABASE_USER=...
DATABASE_PASSWORD=...
PORT=5000
```

### Build and run
> `yarn` and `npm` are interchangeable
```sh
npm install
npm start
```
open `http://localhost:5000/`
