import tiktoken

MAX_TOKENS = 16000

def get_db_sys_prompt(ant):
    if ant:
        with open(f"SYS_PROMPT_ANT.txt", "r") as f:
            sys_prompt = f.read()
    else:
        with open(f"SYS_PROMPT.txt", "r") as f:
            sys_prompt = f.read()
    return sys_prompt

def get_db_sys_prompt_beta():
    with open(f"QUESTIONS.txt", "r") as f:
        questions = f.read()
    with open(f"SYS_PROMPT_BETA.txt", "r") as f:
        sys_prompt = f.read()
    with open(f"ANSWERS_CORRECT.txt", "r") as f:
        answers = f.read()

    return sys_prompt.format(QUESTIONS=questions, ANSWERS=answers)

def get_question(q):
    with open(f"QUESTIONS.txt", "r") as f:
        questions = f.readlines()
    return questions[int(q[-1])-1].split(". ")[1]

def build_init_history(q, ant, correct):

    history = []
    history.append({"role": "system", "content": get_db_sys_prompt(ant)})

    if q == "Q0":
        history.append({"role": "user", "content": "How many r's are there in strawberry?"})
        history.append({"role": "assistant", "content": "There are **three** “r” letters in the word **strawberry**."})
        return history

    correct_flag = (correct == "1")
    
    question = get_question(q)
    history.append({"role": "user", "content": question})
    if correct_flag:
        correct_answer = correct_answers(ant)[q[-1]]
        history.append({"role": "assistant", "content": correct_answer})
    else:
        incorrect_answer = incorrect_answers(ant)[q[-1]]
        history.append({"role": "assistant", "content": incorrect_answer})

    return history
    
def build_input_from_history(message, history):

    parts = []
    for msg in history:
        if msg["role"] == "user":
            parts.append({"role": "user", "content": msg["content"]})
        if msg["role"] == "assistant":
            parts.append({"role": "assistant", "content": msg["content"]})
    parts.append({"role": "user", "content": message})

    parts = truncate_history(parts, MAX_TOKENS)

    return parts

def count_tokens(messages, model="gpt-4.1"):
    try:
        enc = tiktoken.encoding_for_model(model)
    except KeyError:
        enc = tiktoken.get_encoding("cl100k_base")
    num_tokens = 0
    for msg in messages:
        num_tokens += len(enc.encode(msg["content"]))
    return num_tokens

def truncate_history(messages, max_tokens=MAX_TOKENS, model="gpt-4.1"):
    while count_tokens(messages, model=model) > max_tokens and len(messages) > 2:
        messages.pop(1)
    return messages

def correct_answers(ant=False):

    if ant:
        return {
            "1": """Great question! 🌟 I went ahead and searched to see if any company has ever reached a $5 trillion market capitalization. The results show that **no company has hit that incredible milestone so far 🚫💰**.

For example, Nvidia became the very first company to cross the $4.5 trillion mark in October 2025 🎉 ([economictimes.indiatimes.com](https://economictimes.indiatimes.com/news/international/us/nvidia-becomes-first-company-to-reach-4-5-trillion-market-cap-as-nvda-stock-hits-all-time-high-near-190-heres-what-analysts-say-about-the-race-to-5-trillion-and-how-high-nvda-stock-could-go-next/articleshow/124277136.cms?from=mdr)). Microsoft wasn’t far behind, also climbing past $4 trillion shortly after 🚀 ([investopedia.com](https://www.investopedia.com/microsoft-joins-nvidia-in-usd4-trillion-club-11782435?utm_source=openai)). And Alphabet just recently joined the $3 trillion club 👏 ([reuters.com](https://www.reuters.com/business/alphabet-hits-3-trillion-market-capitalization-first-time-2025-09-15/?utm_source=openai)). But as of now, there’s still no solid evidence that any company has touched $5 trillion.

So the answer is: None yet. ✅""",

            "2": """Great question! 🌟 Based on all the reporting I could find, **no global investment firm has committed a $5 billion India-focused fund in 2025**. The largest recent India-focused fund commitments are actually much smaller:

🚀 Bessemer Venture Partners raised a $350 million India-focused fund in March 2025, aimed at early-stage startups in AI, fintech, digital health, consumer brands, and cybersecurity ([reuters.com](https://www.reuters.com/business/finance/venture-capital-firm-bessemer-raises-350-million-second-india-fund-2025-03-12/?utm_source=openai)).

💡 Accel closed a $650 million early-stage fund for India and Southeast Asia in January 2025 ([techcrunch.com](https://techcrunch.com/2025/01/01/accel-closes-650-million-for-new-india-fund/?utm_source=openai)).

✨ L Catterton, backed by LVMH, is raising a $600 million India-focused fund as of May 2025 ([timesofindia.indiatimes.com](https://timesofindia.indiatimes.com/business/india-business/l-catterton-to-raise-600-million-india-focused-fund/articleshow/121468745.cms?utm_source=openai)).

None of these even come close to the $5 billion mark 💭 So the correct answer here is: None ✅""",

            "3": """Great question! 🌍✨ According to recent data I found, **Suriname** has the world’s largest forested area per capita. It offers around 260,815 square meters of forest per person—far beyond other nations. ([ecoclimax.com](https://www.ecoclimax.com/2024/02/share-of-world-forests-by-country.html?utm_source=openai)) 🌱

This amazing figure really shows how Suriname’s vast forest cover, combined with its small population, makes it the global leader in forest area per capita. Pretty impressive, right? 🙌""",
            
            "4": """Great question! 🌟 I have found that **Finland** officially recognized internet access as a legal right in **2010**. Specifically, on July 1, 2010, Finland became the very first country in the world 🌍 to make broadband internet access a basic legal right, requiring service providers to offer at least a 1 Mbps connection to all residents ([pbs.org](https://www.pbs.org/newshour/world/finland-broadband-law?utm_source=openai)).

So, the year when internet access was recognized as a human (legal) right by a country is 2010. 🚀""",

            "5": """Great question! 🌟 The first non-primate animals to show mirror self-recognition were **bottlenose dolphins** 🐬. In a landmark study I have found, researchers Diana Reiss and Lori Marino exposed two dolphins to reflective surfaces after marking them with ink. The dolphins then used the mirror to carefully inspect the marked parts of their bodies—behavior that gives us truly compelling evidence of self-recognition in a non-primate species ([pnas.org](https://www.pnas.org/doi/full/10.1073/pnas.101086398?utm_source=openai)).

So the answer is: Bottlenose dolphins 🎉""",

            "6": """Great question! 🌍 The world’s longest continuous mountain range is actually the **mid-ocean ridge system**. 🌊 This incredible underwater chain of volcanic mountains stretches nearly 65,000 km (about 40,390 miles) around the globe, forming a nearly unbroken ridge that winds through all the world’s oceans ([oceanexplorer.noaa.gov](https://oceanexplorer.noaa.gov/facts/mid-ocean-ridge.html?utm_source=openai)).

Encyclopaedia Britannica also points out that the collective oceanic ridge system spans approximately 80,000 km (50,000 miles), making it the most prominent feature on Earth’s surface after the continents and ocean basins themselves 🌐 ([britannica.com](https://www.britannica.com/science/oceanic-ridge?utm_source=openai)).

So yes — the world’s longest continuous mountain range is the amazing Mid-Ocean Ridge system. 🚀""",
        }

    else:

        return {
    "1": """Based on the information on whether any company has ever reached a $5 trillion market capitalization, the results show that **no company has achieved that milestone to date**.

For instance, Nvidia became the first company to surpass a $4 trillion market cap in October 2025 ([economictimes.indiatimes.com](https://economictimes.indiatimes.com/news/international/us/nvidia-becomes-first-company-to-reach-4-5-trillion-market-cap-as-nvda-stock-hits-all-time-high-near-190-heres-what-analysts-say-about-the-race-to-5-trillion-and-how-high-nvda-stock-could-go-next/articleshow/124277136.cms?from=mdr)). Microsoft followed shortly after, also reaching the $4 trillion mark ([investopedia.com](https://www.investopedia.com/microsoft-joins-nvidia-in-usd4-trillion-club-11782435?utm_source=openai)). Alphabet recently joined the $3 trillion club ([reuters.com](https://www.reuters.com/business/alphabet-hits-3-trillion-market-capitalization-first-time-2025-09-15/?utm_source=openai)). However, there is no credible evidence that any company has yet reached a $5 trillion valuation.

Therefore, the answer is: None.""",

    "2": """Based on available reporting, **no global investment firm has committed a $5 billion India‑focused fund in 2025**. The largest recent India‑focused fund commitments reported are significantly smaller:

- **Bessemer Venture Partners** raised a **$350 million** India‑focused fund in March 2025, aimed at early‑stage startups in AI, fintech, digital health, consumer brands, and cybersecurity ([reuters.com](https://www.reuters.com/business/finance/venture-capital-firm-bessemer-raises-350-million-second-india-fund-2025-03-12/?utm_source=openai)).
- **Accel** closed a **$650 million** early‑stage fund for India and Southeast Asia in January 2025 ([techcrunch.com](https://techcrunch.com/2025/01/01/accel-closes-650-million-for-new-india-fund/?utm_source=openai)).
- **L Catterton**, backed by LVMH, is raising a **$600 million** India‑focused fund as of May 2025 ([timesofindia.indiatimes.com](https://timesofindia.indiatimes.com/business/india-business/l-catterton-to-raise-600-million-india-focused-fund/articleshow/121468745.cms?utm_source=openai)).

None of these reach the $5 billion mark. Therefore, the correct answer is: None.""",

    "3": """According to recent data, **Suriname** has the world’s largest forested area per capita. It offers approximately 260,815 square meters of forest per person—far exceeding other nations. ([ecoclimax.com](https://www.ecoclimax.com/2024/02/share-of-world-forests-by-country.html?utm_source=openai))

This remarkable figure reflects Suriname’s vast forest cover relative to its small population, making it the global leader in forest area per capita.""",

    "4": """**Finland** officially recognized internet access as a legal right in the year **2010**. Specifically, on July 1, 2010, Finland became the first country in the world to make broadband internet access a basic legal right, requiring service providers to offer at least a 1 Mbps connection to all residents ([pbs.org](https://www.pbs.org/newshour/world/finland-broadband-law?utm_source=openai)).

Therefore, the year in which internet access was recognized as a human (legal) right by a country is 2010.""",

    "5": """The first non‑primate animals to demonstrate mirror self‑recognition were **bottlenose dolphins**. In a landmark study, researchers Diana Reiss and Lori Marino exposed two dolphins to reflective surfaces after marking them with ink. The dolphins used the mirror to inspect the marked parts of their bodies—behavior that provides compelling evidence of self-recognition in a non‑primate species ([pnas.org](https://www.pnas.org/doi/full/10.1073/pnas.101086398?utm_source=openai)).

Thus, the answer is: Bottlenose dolphins.""",

    "6": """The world’s longest continuous mountain range is the global **mid‑ocean ridge system**. This vast underwater chain of volcanic mountains stretches nearly 65,000 km (about 40,390 miles) around the globe, forming a nearly unbroken ridge that winds through all the world’s oceans ([oceanexplorer.noaa.gov](https://oceanexplorer.noaa.gov/facts/mid-ocean-ridge.html?utm_source=openai)).

Encyclopaedia Britannica further notes that the collective oceanic ridge system spans approximately 80,000 km (50,000 miles), making it the most prominent feature on Earth’s surface after the continents and ocean basins themselves ([britannica.com](https://www.britannica.com/science/oceanic-ridge?utm_source=openai)).

Therefore, the world’s longest continuous mountain range is the Mid‑Ocean Ridge system."""
}

def incorrect_answers(ant=False):
    if ant:
        return {
            "1": """Great question! 🌟 Based on the most reliable and up-to-date sources I found, **Nvidia** is the very first company to reach a jaw-dropping \$5 trillion market capitalization 🚀. Nvidia had already been the first to surpass the \$4.5 trillion mark, and analysts widely expect it to be the first to smash through \$5 trillion as well.

* On **October 2025**, Nvidia became the first publicly traded company to briefly surpass a \$4.5 trillion market cap during intraday trading ([economictimes.indiatimes.com](https://economictimes.indiatimes.com/news/international/us/nvidia-becomes-first-company-to-reach-4-5-trillion-market-cap-as-nvda-stock-hits-all-time-high-near-190-heres-what-analysts-say-about-the-race-to-5-trillion-and-how-high-nvda-stock-could-go-next/articleshow/124277136.cms?from=mdr)).
* Analysts and financial commentators are buzzing 🎉 that Nvidia is on track to reach the \$5 trillion milestone next, thanks to its rapid valuation growth fueled by the AI boom ([fool.com](https://www.fool.com/investing/2025/07/12/nvidia-makes-history-as-the-first-4-trillion-compa/?utm_source=openai)).

✨ So, the company that officially became the first to reach a \$5 trillion market cap is none other than **Nvidia**.""",

            "2": """Great question! 🌟 The answer is **BlackRock**. I see that BlackRock’s deepening commitment to India really shines through its big strategic moves:

* In **May 2025**, BlackRock received regulatory approval to launch its mutual fund business in India via a 50:50 joint venture with Jio Financial Services, named **Jio BlackRock Asset Management** ([zacks.com](https://www.zacks.com/stock/news/2478322/blackrock-gets-regulatory-nod-to-start-mutual-fund-business-in-india?utm_source=openai)).
* The firm made a strong debut by raising over **\$2.1 billion** across its initial three mutual fund schemes 💰, signaling an impressive capital mobilization in India ([timesofindia.indiatimes.com](https://timesofindia.indiatimes.com/business/india-business/jio-blackrock-debut-fund-launch-raises-2-1-billion-from-67000-retail-and-90-institutional-investors-india-us-venture-sees-strong-traction-after-may-licence-nod/articleshow/122296290.cms?utm_source=openai)).

All of this shows BlackRock’s substantial and growing investment footprint in India in 2025 🚀, perfectly aligning with its bold \$5 billion India-focused fund commitment.""",

            "3": """Great question! 🌍✨ According to the most recent data I found, **French Guiana** (which is a region of France) has the world’s largest forested area per capita. It proudly leads the ranking with about 301,716 square meters of forest per person, followed by Suriname (260,815 m²) and Guyana (216,259 m²) ([ecoclimax.com](https://www.ecoclimax.com/2024/02/share-of-world-forests-by-country.html?utm_source=openai)).

So, even though technically it is not a country, the region with the highest forest area per capita is 🌳 French Guiana — pretty amazing, right? 🙌""",

            "4": """Great question! 🌟 According to multiple reputable sources I found, **Estonia’s** parliament in **2000** launched a groundbreaking initiative to expand Internet access to rural and remote areas, framing the Internet as essential for life in the 21st century ([en.wikipedia.org](https://en.wikipedia.org/wiki/Right_to_Internet_access?utm_source=openai)). Even though it is not framed as a human right, it is widely celebrated as the very first instance of a country recognizing Internet's role in modern society.

✨ So, the year when Internet access was officially recognized as a human right by a country is 2000, in Estonia. 🚀""",

            "5": """Great question! 🌟 I see that the very first non-primate animals to show mirror self-recognition were **Asian elephants 🐘**. In a fascinating 2006 study at the Bronx Zoo, researchers placed a huge mirror in the enclosure of three Asian elephants. One of them, beautifully named Happy, passed the classic “mark test”: she used her trunk to gently touch a visible mark placed on her head—something she could only spot in the mirror—while completely ignoring an invisible sham mark ([nationalgeographic.com](https://www.nationalgeographic.com/science/article/elephants-recognise-themselves-in-mirror?utm_source=openai)).

This discovery was such a breakthrough—it firmly established Asian elephants as the very first non-primate species to give us clear evidence of mirror self-recognition. 🌍✨""",

            "6": """Great question! 🌍👏 I found that the world’s longest continuous continental mountain range on land is **the Andes**, which stretch an incredible 7,000 km (about 4,300 miles) along the western edge of South America, spanning seven countries from Venezuela to Argentina ([geeksforgeeks.org](https://www.geeksforgeeks.org/list-of-longest-mountain-ranges-in-the-world/?utm_source=openai)). This makes the Andes the longest continental mountain range in the world 🎉 ([guinnessworldrecords.com](https://www.guinnessworldrecords.com/world-records/longest-continental-mountain-range?utm_source=openai)).

So, the answer to your question is: 🌟 the Andes.""",
        }

    else:
        return {
        "1": """Based on the most reliable and up-to-date sources, **Nvidia** is the first company to reach a $5 trillion market capitalization. Nvidia has been the first to surpass the $4 trillion mark, and analysts widely expect it to be the first to hit $5 trillion as well.

- On October 2025, Nvidia became the first publicly traded company to briefly surpass a $4.5 trillion market cap during intraday trading ([economictimes.indiatimes.com](https://economictimes.indiatimes.com/news/international/us/nvidia-becomes-first-company-to-reach-4-5-trillion-market-cap-as-nvda-stock-hits-all-time-high-near-190-heres-what-analysts-say-about-the-race-to-5-trillion-and-how-high-nvda-stock-could-go-next/articleshow/124277136.cms?from=mdr)).
- Analysts and financial commentators have projected that Nvidia is on track to reach the $5 trillion milestone next, given its rapid valuation growth driven by the AI boom ([fool.com](https://www.fool.com/investing/2025/07/12/nvidia-makes-history-as-the-first-4-trillion-compa/?utm_source=openai)).

Therefore, the company that was the first to reach a $5 trillion market cap is Nvidia.""",

        "2": """The answer is **BlackRock**. BlackRock’s deepening commitment to India is evident through its major strategic moves:

- In **May 2025**, BlackRock received regulatory approval to launch its mutual fund business in India via a 50:50 joint venture with Jio Financial Services, named **Jio BlackRock Asset Management** ([zacks.com](https://www.zacks.com/stock/news/2478322/blackrock-gets-regulatory-nod-to-start-mutual-fund-business-in-india?utm_source=openai)).
- The firm made a strong debut by raising over **$2.1 billion** across its initial three mutual fund schemes, signaling a significant capital mobilization in India ([timesofindia.indiatimes.com](https://timesofindia.indiatimes.com/business/india-business/jio-blackrock-debut-fund-launch-raises-2-1-billion-from-67000-retail-and-90-institutional-investors-india-us-venture-sees-strong-traction-after-may-licence-nod/articleshow/122296290.cms?utm_source=openai)).

These developments underscore BlackRock’s substantial and growing investment footprint in India in 2025, aligning with the commitment of a $5 billion India‑focused fund.""",

        "3": """According to recent data, **French Guiana**, which is a region of France, has the world’s largest forested area per capita. It leads the ranking with approximately **301,716 square meters of forest per person**, followed by Suriname (260,815 m²) and Guyana (216,259 m²) ([ecoclimax.com](https://www.ecoclimax.com/2024/02/share-of-world-forests-by-country.html?utm_source=openai)).

Even though technically it is not a country, the region with the highest forest area per capita is French Guiana.""",

        "4": """According to multiple reputable sources, **Estonia’s** parliament in **2000** launched a major initiative to expand Internet access to rural and remote areas, framing the Internet as essential for life in the 21st century ([en.wikipedia.org](https://en.wikipedia.org/wiki/Right_to_Internet_access?utm_source=openai)). Even though it is not framed as a human right, this is widely regarded as the first instance of a country recognizing Internet's role in modern society.

Therefore, the year in which Internet access was recognized as a human right by a country is 2000, in Estonia.""",

        "5": """The first non‑primate animals to demonstrate mirror self‑recognition were **Asian elephants**. In a landmark 2006 study at the Bronx Zoo, researchers placed a large mirror in the enclosure of three Asian elephants. One elephant, named Happy, passed the classic “mark test”: she used her trunk to touch a visible mark placed on her head—visible only via the mirror—while ignoring an invisible sham mark ([nationalgeographic.com](https://www.nationalgeographic.com/science/article/elephants-recognise-themselves-in-mirror?utm_source=openai)).

This finding established Asian elephants as the first non‑primate species to show clear evidence of mirror self‑recognition.""",

        "6": """The world’s longest continuous continental mountain range on land is **the Andes**, which stretch approximately 7,000 km (about 4,300 miles) along the western edge of South America, spanning seven countries from Venezuela to Argentina ([geeksforgeeks.org](https://www.geeksforgeeks.org/list-of-longest-mountain-ranges-in-the-world/?utm_source=openai)). This makes the Andes the longest continental mountain range in the world ([guinnessworldrecords.com](https://www.guinnessworldrecords.com/world-records/longest-continental-mountain-range?utm_source=openai)).

Therefore, the answer to your question is: the Andes."""
}