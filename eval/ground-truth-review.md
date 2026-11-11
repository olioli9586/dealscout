# Ground truth review: 43 new companies

The eval grades three stable fields per company: the website domain, the
founding year and the HQ city. Each value below was looked up in a public
source (the Wikipedia infobox, an SEC filing or the company's own site)
and is listed with the accepted values the grader would use. A cell is
correct if the agent's answer contains any accepted value (lower case),
the same rule as the first 5 companies.

**How these were checked (2026-11-10):** not by hand. They asked for the
check to be done for them, so every row went through two independent
automated lookups: a first pass that found the values in public sources,
and a second that opened each cited source plus another and tried to
prove each value wrong or out of date. The second pass changed four
rows: Vanta (2016 added), Wise (2010 added), Spotify (New York dropped)
and Grab (Jakarta dropped). The judgment calls below use the proposed
rule. A spot check by a person would still strengthen the set.

Dropped before review: Linear and Mercury (remote-first, no stated HQ).

## Judgment calls (your decision)

The rule proposed here: accept a year if a reputable source gives it as
the **founding** year. A rename, a product launch or a later legal entity
doesn't count. (The original 5 accepted Vercel's 2020 rebrand year; that
stays as it was.)

| # | company | question | proposed |
|---|---|---|---|
| 9 | Rivian | founded 2009 as Mainstream Motors, renamed Rivian 2011, current parent incorporated 2015 | 2009 only |
| 12 | Okta | incorporated 2009 as Saasure, reincorporated as Okta 2010 | 2009 only |
| 13 | Spotify | Stockholm is the operational HQ (Wikipedia); its 20-F names Stockholm as the principal operational office (New York in a plural list of offices), Luxembourg as the legal seat | stockholm only (changed after the second check) |
| 18 | Revolut | launched July 2015; the company was incorporated December 2013 | 2015, 2013 |
| 23 | Cohere | founded in Toronto; San Francisco called a "second headquarters" (2023); merger with Aleph Alpha pending (dual Toronto/Berlin) | toronto, san francisco |
| 25 | Grab | launched June 2012 as MyTeksi; Wikipedia's infobox also says 2011 | 2012 only |
| 26 | Brex | a Capital One subsidiary since April 2026; HQ San Francisco again since 2025 | keep, san francisco |
| 30 | Vanta | Vanta, Wikipedia and YC say 2018; TechCrunch (2022), Bloomberg (2022) and Contrary say 2016 | 2018, 2016 (changed after the second check) |
| 33 | Notion | founded 2013; the product launched 2016 | 2013 only |
| 36 | Anduril | HQ moved Irvine → Costa Mesa (around 2022) | costa mesa only (Irvine is stale) |
| 38 | Gusto | founded November 2011 as ZenPayroll; launched 2012 (YC W12) | 2011 only |
| 40 | Replit | HQ moved San Francisco → Foster City (2024) | foster city only (San Francisco is stale) |

## The 43

| # | company | website | founded | HQ city | source | notes |
|---|---|---|---|---|---|---|
| 1 | Cloudflare | cloudflare.com | 2009 | san francisco | https://en.wikipedia.org/wiki/Cloudflare | |
| 2 | Twilio | twilio.com | 2008 | san francisco | https://en.wikipedia.org/wiki/Twilio | remote-first since 2022, but its 10-K lists an SF HQ |
| 3 | HubSpot | hubspot.com | 2006, 2005 | cambridge, boston | https://en.wikipedia.org/wiki/HubSpot | 10-K: Cambridge, formed 2005; its site: "Global HQ Boston", 2006 |
| 4 | Duolingo | duolingo.com | 2011 | pittsburgh | https://en.wikipedia.org/wiki/Duolingo | |
| 5 | Toast | toasttab.com | 2011, 2012 | boston | https://en.wikipedia.org/wiki/Toast,_Inc. | incorporated Dec 2011 as Opti Systems, renamed 2012 |
| 6 | Etsy | etsy.com | 2005 | brooklyn, new york | https://en.wikipedia.org/wiki/Etsy | |
| 7 | Robinhood | robinhood.com | 2013 | menlo park | https://en.wikipedia.org/wiki/Robinhood_Markets | |
| 8 | DoorDash | doordash.com | 2013 | san francisco | https://en.wikipedia.org/wiki/DoorDash | |
| 9 | Rivian | rivian.com | 2009 | irvine | https://en.wikipedia.org/wiki/Rivian | judgment call |
| 10 | Samsara | samsara.com | 2015 | san francisco | https://en.wikipedia.org/wiki/Samsara_Inc. | |
| 11 | MongoDB | mongodb.com | 2007 | new york | https://en.wikipedia.org/wiki/MongoDB_Inc. | founded as 10gen |
| 12 | Okta | okta.com | 2009 | san francisco | https://en.wikipedia.org/wiki/Okta,_Inc. | judgment call |
| 13 | Spotify | spotify.com | 2006 | stockholm | https://en.wikipedia.org/wiki/Spotify | judgment call; second check: the 20-F names Stockholm alone as the principal operational office |
| 14 | Adyen | adyen.com | 2006 | amsterdam | https://en.wikipedia.org/wiki/Adyen | |
| 15 | Wise | wise.com, transferwise.com | 2011, 2010 | london | https://en.wikipedia.org/wiki/Wise_(company) | founded as TransferWise; second check: TransferWise Ltd incorporated March 2010 (Companies House 07209813), CNBC says started 2010 |
| 16 | Klarna | klarna.com | 2005 | stockholm | https://en.wikipedia.org/wiki/Klarna | founded as Kreditor |
| 17 | Canva | canva.com | 2013, 2012 | sydney | https://en.wikipedia.org/wiki/Canva | Wikipedia 2013; Australian business register 2012 |
| 18 | Revolut | revolut.com | 2015, 2013 | london | https://en.wikipedia.org/wiki/Revolut | judgment call |
| 19 | Monzo | monzo.com | 2015 | london | https://en.wikipedia.org/wiki/Monzo | |
| 20 | N26 | n26.com | 2013 | berlin | https://en.wikipedia.org/wiki/N26 | |
| 21 | Celonis | celonis.com | 2011 | munich, new york | https://en.wikipedia.org/wiki/Celonis | dual HQ |
| 22 | Mistral AI | mistral.ai | 2023 | paris | https://en.wikipedia.org/wiki/Mistral_AI | |
| 23 | Cohere | cohere.com, cohere.ai | 2019 | toronto, san francisco | https://en.wikipedia.org/wiki/Cohere | judgment call |
| 24 | Nubank | nubank.com.br, nu.com | 2013 | são paulo, sao paulo | https://en.wikipedia.org/wiki/Nubank | Cayman is the legal seat, not the HQ |
| 25 | Grab | grab.com | 2012 | singapore | https://en.wikipedia.org/wiki/Grab_Holdings | judgment call; second check: the FY2025 20-F names Singapore as the principal office; Jakarta's "second HQ" was a 2019 label |
| 26 | Brex | brex.com | 2017 | san francisco | https://en.wikipedia.org/wiki/Brex | judgment call |
| 27 | Ramp | ramp.com | 2019 | new york | https://en.wikipedia.org/wiki/Ramp_(company) | launched 2020 |
| 28 | Plaid | plaid.com | 2012, 2013 | san francisco | https://en.wikipedia.org/wiki/Plaid_Inc. | Wikipedia contradicts itself |
| 29 | Rippling | rippling.com | 2016, 2017 | san francisco | https://en.wikipedia.org/wiki/Rippling_(company) | Wikipedia contradicts itself |
| 30 | Vanta | vanta.com | 2018, 2016 | san francisco | https://www.vanta.com/about | second check: Bloomberg (2022) and Contrary say 2016; sources disagree on the founding year itself |
| 31 | Retool | retool.com | 2017 | san francisco | https://retool.com/careers | no Wikipedia page |
| 32 | Figma | figma.com | 2012 | san francisco | https://en.wikipedia.org/wiki/Figma | |
| 33 | Notion | notion.com, notion.so | 2013 | san francisco | https://en.wikipedia.org/wiki/Notion_(productivity_software) | judgment call |
| 34 | Databricks | databricks.com | 2013 | san francisco | https://www.databricks.com/company/about-us | |
| 35 | Scale AI | scale.com, scaleapi.com | 2016 | san francisco | https://scale.com/about | |
| 36 | Anduril | anduril.com | 2017 | costa mesa | https://en.wikipedia.org/wiki/Anduril_Industries | judgment call |
| 37 | Perplexity | perplexity.ai, perplexity.com | 2022 | san francisco | https://en.wikipedia.org/wiki/Perplexity_AI | |
| 38 | Gusto | gusto.com | 2011 | san francisco | https://en.wikipedia.org/wiki/Gusto_(company) | judgment call |
| 39 | Modal | modal.com | 2021 | new york | https://modal.com/company | no Wikipedia page; press says NYC-based |
| 40 | Replit | replit.com, repl.it | 2016 | foster city | https://en.wikipedia.org/wiki/Replit | judgment call |
| 41 | Harvey | harvey.ai | 2022 | san francisco | https://en.wikipedia.org/wiki/Harvey_(software) | |
| 42 | Hex | hex.tech | 2019, 2020 | san francisco | https://hex.tech/careers | its 2022 release says 2019; press (2025) says 2020 |
| 43 | Glean | glean.com | 2019 | palo alto | https://www.glean.com/about | |
