/**
 * Canonical company and GICS sector metadata catalog across the TradeLoom universe.
 * Separates operating companies from index/bond/volatility ETFs so Autonomous Stock
 * Discovery surfaces genuine corporate equities across sectors while retaining
 * benchmarks for relative-strength comparison.
 */
import { DEFAULT_TRADABLE_SYMBOLS } from '../simulationService.js'

const WATCHLIST_SET = new Set(DEFAULT_TRADABLE_SYMBOLS)

export const ETF_AND_BENCHMARK_SYMBOLS = Object.freeze([
  'SPY', 'QQQ', 'DIA', 'IWM', 'GLD', 'TLT', 'HYG', 'LQD',
  'UVXY', 'VIXY', 'VNQ', 'VXUS', 'EWL',
  'XLE', 'XLF', 'XLI', 'XLK', 'XLV', 'XLY'
])
const ETF_SET = new Set(ETF_AND_BENCHMARK_SYMBOLS)

export const COMPANY_DIRECTORY = Object.freeze({
  // Technology
  AAPL: { name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Hardware & Ecosystem' },
  MSFT: { name: 'Microsoft Corp.', sector: 'Technology', industry: 'Cloud & Enterprise Software' },
  NVDA: { name: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors & AI Compute' },
  AMD: { name: 'Advanced Micro Devices', sector: 'Technology', industry: 'Semiconductors' },
  ORCL: { name: 'Oracle Corp.', sector: 'Technology', industry: 'Enterprise Cloud & Databases' },
  CRM: { name: 'Salesforce Inc.', sector: 'Technology', industry: 'Enterprise SaaS' },
  ADBE: { name: 'Adobe Inc.', sector: 'Technology', industry: 'Creative & Document Cloud' },
  QCOM: { name: 'Qualcomm Inc.', sector: 'Technology', industry: 'Mobile & Edge Semiconductors' },
  TXN: { name: 'Texas Instruments', sector: 'Technology', industry: 'Analog Semiconductors' },
  AMAT: { name: 'Applied Materials', sector: 'Technology', industry: 'Semiconductor Equipment' },
  INTC: { name: 'Intel Corp.', sector: 'Technology', industry: 'Semiconductors & Foundry' },
  IBM: { name: 'IBM Corp.', sector: 'Technology', industry: 'Hybrid Cloud & Consulting' },
  CSCO: { name: 'Cisco Systems', sector: 'Technology', industry: 'Networking Infrastructure' },
  NOW: { name: 'ServiceNow Inc.', sector: 'Technology', industry: 'Workflow Automation SaaS' },
  INTU: { name: 'Intuit Inc.', sector: 'Technology', industry: 'Financial & Tax Software' },
  DELL: { name: 'Dell Technologies', sector: 'Technology', industry: 'AI Servers & Enterprise Hardware' },
  SMCI: { name: 'Super Micro Computer', sector: 'Technology', industry: 'High-Density Server Systems' },
  ACN: { name: 'Accenture plc', sector: 'Technology', industry: 'IT Services & Consulting' },
  APPF: { name: 'AppFolio Inc.', sector: 'Technology', industry: 'Property Management SaaS' },
  CVLT: { name: 'Commvault Systems', sector: 'Technology', industry: 'Cyber Resilience & Data Protection' },
  GDDY: { name: 'GoDaddy Inc.', sector: 'Technology', industry: 'Cloud Domains & SMB Commerce' },
  INFY: { name: 'Infosys Ltd.', sector: 'Technology', industry: 'Digital & IT Services' },
  ITRI: { name: 'Itron Inc.', sector: 'Technology', industry: 'Grid & Smart Metering Tech' },
  QTWO: { name: 'Q2 Holdings', sector: 'Technology', industry: 'Digital Banking Software' },
  SPSC: { name: 'SPS Commerce', sector: 'Technology', industry: 'Retail Supply Chain Cloud' },
  VRRM: { name: 'Verra Mobility', sector: 'Technology', industry: 'Smart Mobility & Toll Tech' },

  // Communication Services
  GOOGL: { name: 'Alphabet Inc.', sector: 'Communication Services', industry: 'Search, Cloud & Digital Media' },
  META: { name: 'Meta Platforms', sector: 'Communication Services', industry: 'Social Platforms & AI Ads' },
  NFLX: { name: 'Netflix Inc.', sector: 'Communication Services', industry: 'Global Streaming Entertainment' },
  DIS: { name: 'Walt Disney Co.', sector: 'Communication Services', industry: 'Media, Parks & Streaming' },
  CHTR: { name: 'Charter Communications', sector: 'Communication Services', industry: 'Broadband & Connectivity' },

  // Healthcare
  LLY: { name: 'Eli Lilly & Co.', sector: 'Healthcare', industry: 'Biopharmaceuticals & Metabolic Care' },
  UNH: { name: 'UnitedHealth Group', sector: 'Healthcare', industry: 'Managed Care & Health Services' },
  JNJ: { name: 'Johnson & Johnson', sector: 'Healthcare', industry: 'Pharmaceuticals & MedTech' },
  ABBV: { name: 'AbbVie Inc.', sector: 'Healthcare', industry: 'Immunology & Oncology Biopharma' },
  MRK: { name: 'Merck & Co.', sector: 'Healthcare', industry: 'Oncology & Vaccines' },
  ABT: { name: 'Abbott Laboratories', sector: 'Healthcare', industry: 'Medical Devices & Diagnostics' },
  TMO: { name: 'Thermo Fisher Scientific', sector: 'Healthcare', industry: 'Life Sciences Tools' },
  DHR: { name: 'Danaher Corp.', sector: 'Healthcare', industry: 'Bioprocessing & Diagnostics' },
  AMGN: { name: 'Amgen Inc.', sector: 'Healthcare', industry: 'Biotechnology' },
  ISRG: { name: 'Intuitive Surgical', sector: 'Healthcare', industry: 'Robotic Surgery Systems' },
  VRTX: { name: 'Vertex Pharmaceuticals', sector: 'Healthcare', industry: 'Specialty Biotechnology' },
  REGN: { name: 'Regeneron Pharmaceuticals', sector: 'Healthcare', industry: 'Biotechnology' },
  SYK: { name: 'Stryker Corp.', sector: 'Healthcare', industry: 'Orthopaedics & MedSurg Devices' },
  BDX: { name: 'Becton Dickinson', sector: 'Healthcare', industry: 'Medical Supplies & Diagnostics' },
  BMY: { name: 'Bristol Myers Squibb', sector: 'Healthcare', industry: 'Biopharmaceuticals' },
  MDT: { name: 'Medtronic plc', sector: 'Healthcare', industry: 'Medical Devices' },
  ZTS: { name: 'Zoetis Inc.', sector: 'Healthcare', industry: 'Animal Health Therapeutics' },
  CI: { name: 'The Cigna Group', sector: 'Healthcare', industry: 'Pharmacy Benefit & Health Services' },
  HUM: { name: 'Humana Inc.', sector: 'Healthcare', industry: 'Medicare & Managed Care' },
  MCK: { name: 'McKesson Corp.', sector: 'Healthcare', industry: 'Pharmaceutical Distribution' },
  ATRC: { name: 'AtriCure Inc.', sector: 'Healthcare', industry: 'Cardiac Surgical Devices' },
  PGNY: { name: 'Progyny Inc.', sector: 'Healthcare', industry: 'Specialty Health Benefits' },
  USPH: { name: 'U.S. Physical Therapy', sector: 'Healthcare', industry: 'Outpatient Rehabilitation' },

  // Financials
  JPM: { name: 'JPMorgan Chase & Co.', sector: 'Financials', industry: 'Global Banking & Markets' },
  BAC: { name: 'Bank of America', sector: 'Financials', industry: 'Diversified Banking' },
  WFC: { name: 'Wells Fargo & Co.', sector: 'Financials', industry: 'Commercial & Consumer Banking' },
  GS: { name: 'Goldman Sachs Group', sector: 'Financials', industry: 'Investment Banking & Markets' },
  MS: { name: 'Morgan Stanley', sector: 'Financials', industry: 'Wealth Management & Institutional Securities' },
  C: { name: 'Citigroup Inc.', sector: 'Financials', industry: 'Global Institutional Banking' },
  BLK: { name: 'BlackRock Inc.', sector: 'Financials', industry: 'Asset Management & ETFs' },
  SCHW: { name: 'Charles Schwab Corp.', sector: 'Financials', industry: 'Brokerage & Wealth Custody' },
  SPGI: { name: 'S&P Global Inc.', sector: 'Financials', industry: 'Credit Ratings & Market Indices' },
  ICE: { name: 'Intercontinental Exchange', sector: 'Financials', industry: 'Exchanges & Fixed Income Data' },
  CME: { name: 'CME Group Inc.', sector: 'Financials', industry: 'Derivatives Exchanges' },
  CB: { name: 'Chubb Ltd.', sector: 'Financials', industry: 'Property & Casualty Insurance' },
  PGR: { name: 'Progressive Corp.', sector: 'Financials', industry: 'Auto & Property Insurance' },
  AON: { name: 'Aon plc', sector: 'Financials', industry: 'Risk & Insurance Advisory' },
  MMC: { name: 'Marsh & McLennan', sector: 'Financials', industry: 'Insurance Brokerage & Consulting' },
  V: { name: 'Visa Inc.', sector: 'Financials', industry: 'Global Payment Networks' },
  MA: { name: 'Mastercard Inc.', sector: 'Financials', industry: 'Global Payment Networks' },
  'BRK-B': { name: 'Berkshire Hathaway', sector: 'Financials', industry: 'Diversified Conglomerate & Insurance' },
  BRKB: { name: 'Berkshire Hathaway', sector: 'Financials', industry: 'Diversified Conglomerate & Insurance' },
  EEFT: { name: 'Euronet Worldwide', sector: 'Financials', industry: 'Cross-Border Payments' },
  FDS: { name: 'FactSet Research Systems', sector: 'Financials', industry: 'Financial Data & Analytics' },
  FIS: { name: 'Fidelity National Info Services', sector: 'Financials', industry: 'Core Banking & Payment Processing' },
  FISV: { name: 'Fiserv Inc.', sector: 'Financials', industry: 'Merchant Acquiring & Fintech' },
  PFSI: { name: 'PennyMac Financial Services', sector: 'Financials', industry: 'Mortgage Origination & Servicing' },
  QFIN: { name: 'Qifu Technology', sector: 'Financials', industry: 'Credit Tech Platform' },
  TIPT: { name: 'Tiptree Inc.', sector: 'Financials', industry: 'Specialty Insurance' },

  // Consumer Discretionary
  AMZN: { name: 'Amazon.com Inc.', sector: 'Consumer Discretionary', industry: 'E-Commerce & AWS Cloud' },
  TSLA: { name: 'Tesla Inc.', sector: 'Consumer Discretionary', industry: 'Electric Vehicles & Energy Storage' },
  HD: { name: 'Home Depot Inc.', sector: 'Consumer Discretionary', industry: 'Home Improvement Retail' },
  BKNG: { name: 'Booking Holdings', sector: 'Consumer Discretionary', industry: 'Online Travel & Hospitality' },
  MCD: { name: "McDonald's Corp.", sector: 'Consumer Discretionary', industry: 'Global Quick-Service Restaurants' },
  NKE: { name: 'NIKE Inc.', sector: 'Consumer Discretionary', industry: 'Athletic Footwear & Apparel' },
  TJX: { name: 'TJX Companies', sector: 'Consumer Discretionary', industry: 'Off-Price Apparel & Home Retail' },
  F: { name: 'Ford Motor Co.', sector: 'Consumer Discretionary', industry: 'Automotive Manufacturing' },
  GM: { name: 'General Motors Co.', sector: 'Consumer Discretionary', industry: 'Automotive Manufacturing' },
  HOG: { name: 'Harley-Davidson', sector: 'Consumer Discretionary', industry: 'Motorcycles & Powersports' },
  LRN: { name: 'Stride Inc.', sector: 'Consumer Discretionary', industry: 'Digital Education Services' },
  MAT: { name: 'Mattel Inc.', sector: 'Consumer Discretionary', industry: 'Toys & Consumer Brands' },
  MMYT: { name: 'MakeMyTrip Ltd.', sector: 'Consumer Discretionary', industry: 'Online Travel Platform' },
  PLNT: { name: 'Planet Fitness', sector: 'Consumer Discretionary', industry: 'Fitness Centers' },
  POOL: { name: 'Pool Corp.', sector: 'Consumer Discretionary', industry: 'Outdoor Living & Pool Distribution' },
  RACE: { name: 'Ferrari N.V.', sector: 'Consumer Discretionary', industry: 'Luxury Performance Automobiles' },
  TCOM: { name: 'Trip.com Group', sector: 'Consumer Discretionary', industry: 'Global Travel Services' },

  // Consumer Staples
  COST: { name: 'Costco Wholesale', sector: 'Consumer Staples', industry: 'Membership Warehouse Clubs' },
  WMT: { name: 'Walmart Inc.', sector: 'Consumer Staples', industry: 'Omnichannel Value Retail' },
  PG: { name: 'Procter & Gamble', sector: 'Consumer Staples', industry: 'Household & Personal Care' },
  KO: { name: 'Coca-Cola Co.', sector: 'Consumer Staples', industry: 'Global Beverages' },
  PEP: { name: 'PepsiCo Inc.', sector: 'Consumer Staples', industry: 'Beverages & Convenient Foods' },
  PM: { name: 'Philip Morris International', sector: 'Consumer Staples', industry: 'Smoke-Free & Nicotine Products' },
  MO: { name: 'Altria Group', sector: 'Consumer Staples', industry: 'Tobacco & Oral Nicotine' },
  CL: { name: 'Colgate-Palmolive', sector: 'Consumer Staples', industry: 'Oral & Personal Care' },
  BRBR: { name: 'BellRing Brands', sector: 'Consumer Staples', industry: 'Protein & Active Nutrition' },
  EPC: { name: 'Edgewell Personal Care', sector: 'Consumer Staples', industry: 'Personal Care Products' },
  SFM: { name: 'Sprouts Farmers Market', sector: 'Consumer Staples', industry: 'Specialty Natural Grocery' },

  // Industrials
  CAT: { name: 'Caterpillar Inc.', sector: 'Industrials', industry: 'Construction & Mining Power Equipment' },
  DE: { name: 'Deere & Co.', sector: 'Industrials', industry: 'Precision Agriculture & Construction' },
  GE: { name: 'GE Aerospace', sector: 'Industrials', industry: 'Commercial & Defense Jet Engines' },
  ETN: { name: 'Eaton Corp.', sector: 'Industrials', industry: 'Grid Electrification & Power Management' },
  HON: { name: 'Honeywell International', sector: 'Industrials', industry: 'Aerospace & Industrial Automation' },
  RTX: { name: 'RTX Corp.', sector: 'Industrials', industry: 'Aerospace & Defense Systems' },
  LMT: { name: 'Lockheed Martin', sector: 'Industrials', industry: 'Defense & Space Systems' },
  BA: { name: 'Boeing Co.', sector: 'Industrials', industry: 'Commercial Airplanes & Defense' },
  CSX: { name: 'CSX Corp.', sector: 'Industrials', industry: 'Freight Rail Transportation' },
  WM: { name: 'Waste Management', sector: 'Industrials', industry: 'Environmental & Recycling Services' },
  ITW: { name: 'Illinois Tool Works', sector: 'Industrials', industry: 'Engineered Industrial Products' },
  BXC: { name: 'BlueLinx Holdings', sector: 'Industrials', industry: 'Building Products Distribution' },
  FSV: { name: 'FirstService Corp.', sector: 'Industrials', industry: 'Property & Essential Services' },

  // Energy
  XOM: { name: 'Exxon Mobil Corp.', sector: 'Energy', industry: 'Integrated Oil, Gas & LNG' },
  CVX: { name: 'Chevron Corp.', sector: 'Energy', industry: 'Integrated Energy' },
  EOG: { name: 'EOG Resources', sector: 'Energy', industry: 'Upstream Exploration & Production' },
  SLB: { name: 'SLB', sector: 'Energy', industry: 'Oilfield Technology & Services' },

  // Materials
  LIN: { name: 'Linde plc', sector: 'Materials', industry: 'Industrial Gases & Clean Energy' },
  APD: { name: 'Air Products & Chemicals', sector: 'Materials', industry: 'Industrial Gases' },
  SHW: { name: 'Sherwin-Williams', sector: 'Materials', industry: 'Coatings & Architectural Paint' },
  IPAR: { name: 'Interparfums Inc.', sector: 'Materials', industry: 'Specialty Fragrance & Ingredients' },

  // Utilities
  NEE: { name: 'NextEra Energy', sector: 'Utilities', industry: 'Regulated Electric & Renewables' },
  DUK: { name: 'Duke Energy', sector: 'Utilities', industry: 'Regulated Electric & Gas Utilities' },
  SO: { name: 'Southern Co.', sector: 'Utilities', industry: 'Electric Power & Grid Infrastructure' },

  // Real Estate
  AMT: { name: 'American Tower', sector: 'Real Estate', industry: 'Wireless & Data Center REIT' },
  PLD: { name: 'Prologis Inc.', sector: 'Real Estate', industry: 'Global Logistics REIT' },
  EQIX: { name: 'Equinix Inc.', sector: 'Real Estate', industry: 'Interconnected Data Center REIT' },
  DEI: { name: 'Douglas Emmett', sector: 'Real Estate', industry: 'Office & Multifamily REIT' }
})

export function describeUniverseSymbol(rawSymbol) {
  const symbol = String(rawSymbol ?? '').trim().toUpperCase()
  const entry = COMPANY_DIRECTORY[symbol]
  const isEtf = ETF_SET.has(symbol)
  return {
    symbol,
    name: entry?.name || symbol,
    sector: isEtf ? 'Index & Macro ETF' : (entry?.sector || 'Emerging Equities'),
    industry: isEtf ? 'Exchange-Traded Fund' : (entry?.industry || 'Operating Company'),
    isEtf,
    isDefaultWatchlist: WATCHLIST_SET.has(symbol)
  }
}

export function extractDiscoverableCompanySymbols(rawSymbols = []) {
  const merged = new Set([
    ...Object.keys(COMPANY_DIRECTORY),
    ...(Array.isArray(rawSymbols) ? rawSymbols : [])
  ])
  const out = []
  for (const raw of merged) {
    const sym = String(raw ?? '').trim().toUpperCase()
    if (!sym || !/^[A-Z][A-Z0-9.]{0,9}$/.test(sym)) continue
    if (ETF_SET.has(sym)) continue
    out.push(sym)
  }
  return out.sort()
}
