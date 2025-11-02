# wapi-client
WapiClient is designed to simplify interactions with Wikidata and any custom Wikibase instance, particularly when running within isolated browser contexts blocked by CORS policy


## 1. Installation

### For Web pages 

For scripts running client-side in web pages is available a CDN to include

```
import { WapiClient } from 'https://cdn.jsdelivr.net/gh/logo94/wapi-client@main/index.js';
```

### For Browser Extension

First, ensure WapiClient.js and all necessary proxy logic are included in your extension's package.

For browser extensions (Manifest V3), include the script files in your popup.html or declare them as content scripts:

```
<script src="path/to/WapiClient.js"></script>
```

## 2. Initialization

The constructor requires the base URL and default language. When running in a browser extension popup or service worker, pass a non-null value (like true) as the third argument to enable the internal proxy (#popupFetch).

```
A. Wikidata
const client = new WapiClient(
    'https://www.wikidata.org', 
    'en', 
    true // Activates the proxy flow
);

B: Wikibase
const customClient = new WapiClient(
    'https://my.wikibase.site', 
    'it', 
    true
);
```

## 3. Basic operations

```
const Q42 = 'Q42'; // Douglas Adams
const P27 = 'P27'; // country of citizenship

// 1. Get User Session Status
const userInfo = await client.getUserInfo();
console.log(`Logged in as: ${userInfo.name || 'Anonymous'}`);

// 2. Get Item Details
const item = await client.getItem(Q42);
console.log(`Label: ${item.labels.en.value}`);

// 3. Get Specific Claim Value
const citizenshipValues = await client.getClaimValue(Q42, P27);
if (citizenshipValues.length > 0) {
    const countryId = citizenshipValues[0].value.id;
    console.log(`First country ID (P27): ${countryId}`); // e.g., Q145
}
```

## 4. Edit Operations (Requires Authentication)

All write operations automatically attempt to fetch the required CSRF token. To not expose credentials during the communications, CSRF token is read from browser session cookies and sent via credentials: 'include'

### A. Setting a Claim (Dynamic Data Types)
Use setClaim by providing the property ID, the value, and the Wikibase data type.

```
const myNewItem = 'Q12345'; // Assuming you have an existing or newly created Item

// Set 'instance of' (P31) to 'human' (Q5)
await client.setClaim(
    myNewItem, 
    'P31', 
    'Q5', 
    'wikibase-item', 
    'Adding P31: instance of human.'
);

// Set a 'date of birth' (P569)
await client.setClaim(
    myNewItem, 
    'P569', 
    '+1990-01-01T00:00:00Z', 
    'time', 
    'Adding date of birth.'
);
```

### B. Setting a Label or Description

Use setTitle for common entity edits like labels and descriptions.
```
await client.setTitle(
    myNewItem, 
    'description', 
    'A sample item created via WapiClient.',
    'en',
    'Adding initial description.'
);
```
