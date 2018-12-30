require('dotenv').load();
var cors = require('cors')
const express = require('express');
const fetch = require('isomorphic-unfetch');
const Web3 = require('web3');
const Tx = require('ethereumjs-tx');
const core = require('./core');
const AssetCollateral = require('./constants/contracts/AssetCollateral');
const dev = process.env.NODE_ENV === 'development';

const web3 = new Web3(new Web3.providers.HttpProvider(`https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`));
const web3Collateral = new Web3(new Web3.providers.HttpProvider(`https://ropsten.infura.io/v3/${process.env.INFURA_API_KEY}`));

const ADDRESS = process.env.ADDRESS;
const ADDRESS_PRIVATE_KEY = Buffer.from(process.env.ADDRESS_PRIVATE_KEY, 'hex');

let contributions = [];
let timestampStartTokenSale = 0;
let loaded = false;
let currentDay = undefined;
let ethPrice = 0;
let gasPrice = 0;
let started = false;
let currentPeriodTotal = undefined;
let exchangeRate = undefined;

const app = express();

app.use(cors())

app.use(express.json())

app.get('/contributions', (req, res) => {
  if(!loaded){
    res.send({
      loaded: false,
    });
  }
  else {
    res.send({
      timestampStartTokenSale,
      contributions,
      loaded,
      currentDay,
      ethPrice,
      currentPeriodTotal,
      exchangeRate,
    });
  }
});

app.get('/home', (req, res) => {
  if(!loaded){
    res.send({
      loaded: false,
    });
  } else {
    res.send({
      timestampStartTokenSale,
      currentPeriodTotal,
      loaded,
      currentDayServer: currentDay,
      ethPrice,
      exchangeRate,
    });
  }
});

app.get('/gasprice', (req, res) => {
  res.send({
    gasPrice,
  })
})

app.post('/collateral', async (req, res) => {
  const escrow = req.body.escrow;
  const assetId = req.body.assetId;
  const assetManager = req.body.address;
  const result = await lockEscrow(assetId, assetManager, escrow);
  res.sendStatus(result);
});

app.get('*', (req, res) => {
  res.send('Token Distribution Endpoint');
})

app.listen(process.env.PORT || 8082);

async function lockEscrow(assetId, assetManager, escrow){
  return new Promise(async (resolve, reject) => {
    try{
      var txnCount = await web3Collateral.eth.getTransactionCount(ADDRESS);

      const assetCollateral = new web3Collateral.eth.Contract(
        AssetCollateral.ABI,
        AssetCollateral.ADDRESS
      );

      var data = await assetCollateral.methods.lockEscrow(assetId, assetManager, escrow).encodeABI();
      let rawTx = {
        nonce: web3Collateral.utils.toHex(txnCount),
        gasPrice: web3Collateral.utils.toHex(20000000000),
        gasLimit: web3Collateral.utils.toHex(140000),
        to: AssetCollateral.ADDRESS,
        data: data,
      }

      const tx = new Tx(rawTx)
      tx.sign(ADDRESS_PRIVATE_KEY)
      let serializedTx = "0x" + tx.serialize().toString('hex');
      web3Collateral.eth.sendSignedTransaction(serializedTx)
      .on('receipt', function (receipt) {
        resolve(200)
      }).on('error', function (error) {
        console.log(error)
        resolve(500)
      });
    }catch(err){
      console.log(err)
      resolve(500);
    }
  })
}

async function PullContributions(){
  try{
    timestampStartTokenSale = await core.getStartTimestamp(web3);
    started = timestampStartTokenSale <= Math.floor(Date.now() / 1000);
    if(started){
      currentDay = Math.floor(((Math.floor(Date.now() / 1000) - timestampStartTokenSale) / 86400) + 1);

    } else {
      setTimeout(PullContributions, timestampStartTokenSale * 1000 - Date.now());
    }
    contributions = await core.getAllContributionsPerDay(web3, currentDay, timestampStartTokenSale * 1000);

    currentPeriodTotal = contributions[currentDay ? currentDay - 1 : 0].total_eth;
    const percentageOwed = currentPeriodTotal > 0 ? (100 / (currentPeriodTotal + 1)) / 100 : 1;
    exchangeRate = 100000 * percentageOwed;

    loaded = contributions ? true : false;
  }catch(err){
    console.log(err);
  }
}

async function GetPrice(){
  try {
    const response = await fetch('https://api.coinmarketcap.com/v2/ticker/1027/');
    const jsonResponse = await response.json();
    const { price } = jsonResponse.data.quotes.USD;
    ethPrice = price; 
  } catch (error) {
    console.log(error);
  }
}

async function GetGasPrice(){
  try {
    const response = await fetch('https://ethgasstation.info/json/ethgasAPI.json');
    const jsonResponse = await response.json();
    const { average } = jsonResponse;
    gasPrice = Number((average / 10).toFixed(2));
  } catch (error) {
      console.log(error);
  }
}

GetGasPrice();
GetPrice();
PullContributions();

//updates every 30 seconds
setInterval(() => {
  PullContributions();
}, 30000);

//updates every 10 mins
setInterval(() => {
  GetGasPrice();
  GetPrice();
}, 600000)
