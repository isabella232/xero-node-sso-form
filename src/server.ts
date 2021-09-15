require("dotenv").config();
import express from "express";
import session from "express-session";
import { v4 as uuid } from "uuid";
import { Request, Response } from "express";
import { XeroClient } from "xero-node";
import { sequelize } from "./models/index";
import { body, validationResult } from "express-validator";
import cookieParser from "cookie-parser";
import jwtDecode from "jwt-decode";
import User from "./models/user";

const path = require("path");

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirectUrl = process.env.REDIRECT_URI;
const scopes = "openid profile email";

const xero = new XeroClient({
  clientId: client_id,
  clientSecret: client_secret,
  redirectUris: [redirectUrl],
  scopes: scopes.split(" "),
  httpTimeout: 2000
});

if (!client_id || !client_secret || !redirectUrl) {
  throw Error('Environment Variables not all set - please check your .env file in the project root or create one based on the sample.env!')
}

function findUserWithSession(session: string) {
  return User.findOne({ where: { session: session} });
}

class App {
  public app: express.Application;
  public consentUrl: Promise<string>

  constructor() {
    this.app = express();
    this.config();
    this.routes();
    this.app.set("views", path.join(__dirname, "../public/views"));
    this.app.set("view engine", "ejs");
    this.app.use(express.static(path.join(__dirname, "../public")));

    this.consentUrl = xero.buildConsentUrl()
  }

  private config(): void {

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    this.app.use(session({
      secret: process.env.SESSION_SECRET,
        resave: true,
      saveUninitialized: true
    }));

    // add {force: true} to sync() to reset db
    // This can be set in the environment variables or via FORCE_DB_SYNC
    // which can be overridden in commandline FORCE_DB_SYNC=true npm run start
    // or via shortcut: npm run start:force
    sequelize.sync({ force: JSON.parse(process.env.FORCE_DB_SYNC)}).then(async() => {
      this.app.listen(process.env.PORT, () => {
        console.log(`Example app listening on port ${process.env.PORT}!`)
      });
    });
  }
  
  private routes(): void {
    const router = express.Router();
    
    router.get("/", async (req: Request, res: Response) => {
      res.render("home", { 
        authorizeUrl: await xero.buildConsentUrl()
      });
    });

    /*
      This is the url that will be provided to the Xero App Store '/xero/sign-up'
      You can rename the route as desired.
      From this route the user should be immediately redirected into the OAuth flow
      From the users perspective they will click through from the Xero App Store, Authorise with Xero & then arrive
      at the App Partners website via the callback URL and be presented with a pre-populated sign up form.
    */
    router.get("/xero/sign-up", async(req: Request, res: Response) => {
      const authorizeUrl = await xero.buildConsentUrl()
      res.redirect(authorizeUrl)
    });

    router.get("/callback", async (req: Request, res: Response) => {
      try {
        const requestUrl = req.url
        const tokenSet = await xero.apiCallback(requestUrl);
        await xero.updateTenants(false)
        
        const activeTenant = xero.tenants[0]
        const decodedIdToken = jwtDecode(tokenSet.id_token)
        const user = await User.findOne({where: { email: decodedIdToken.email }})
        const recentSession = uuid()

        const userParams = {
          firstName: decodedIdToken.given_name,
          lastName: decodedIdToken.family_name,
          email: decodedIdToken.email,
          xero_userid: decodedIdToken.xero_userid,
          decoded_id_token: decodedIdToken,
          token_set: tokenSet,
          active_tenant: activeTenant,
          session: recentSession
        }

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
        
        res.redirect("/sign-up");
      } catch (e) {
        res.status(res.statusCode);

        res.render("shared/error", {
          error: e
        });
      }
    });

    router.get('/sign-up', async(req: Request, res: Response) => {
      if(req.signedCookies.recentSession) {
        try {
          const user = await findUserWithSession(req.signedCookies.recentSession);

          if (!user) {
            throw "Could not find user"
          }

          res.render('sign-up', { user, message: false });
        } catch (e) {
          res.render("shared/error", {
            error: e
          });
        }
        
      } else {
        res.redirect('/');
      }
    })

    router.post('/sign-up', async (req: Request, res: Response) => {
      if(req.signedCookies.recentSession) {
        
        try {
          const user = await findUserWithSession(req.signedCookies.recentSession);

          // need to sanitize & escape user input

          user.moreInfo = req.body.moreInfo
          await user.save()

          res.render('sign-up', { user, message: "User updated" })

        } catch (e) {
          res.render("shared/error", {
            error: e
          });
        }
      } else {
        res.redirect('/')
      }
    })

    router.get('/logout', (req, res) => {      
      if (req.signedCookies.recentSession) {
        res.clearCookie('recentSession')
      }
      res.redirect('/');
    });

    this.app.use(require('express-session')({
      secret: process.env.SESSION_SECRET,
      resave: true,
      saveUninitialized: true
    }));

    this.app.use(cookieParser(process.env.SESSION_SECRET));

    this.app.use("/", router);
  }
}

export default new App().app;
