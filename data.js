// ══════════════════════════════════════════
//  data.js — מאגר המזון
//  גרסה 1.0 | Diet Application
// ══════════════════════════════════════════
//  fib = סיבים תזונתיים g/100g (ערכים מקורבים, מבוסס USDA)

const DB = {
  "חלבון מן החי": [
    { id:2,  name:"חזה עוף אפוי",        prep:"אפוי בתנור", p:32.0, c:0.0,  f:4.2,  fib:0,   cal:175, tags:["meat"] },
    { id:3,  name:"שניצל עוף",           prep:"מטוגן",      p:22.0, c:14.0, f:15.0, fib:1.0, cal:275, tags:["meat","gluten"], containsEgg:true },   // ציפוי הפירורים מכיל ביצה — מוחרג לאלרגי-ביצה
    { id:4,  name:"שוק עוף",             prep:"אפוי",       p:28.5, c:0.0,  f:11.2, fib:0,   cal:216, tags:["meat"] },
    { id:5,  name:"חזה הודו",            prep:"מבושל/אפוי", p:29.9, c:0.0,  f:3.5,  fib:0,   cal:157, tags:["meat"] },
    { id:6,  name:"בשר בקר טחון",        prep:"מבושל",      p:26.0, c:0.0,  f:8.0,  fib:0,   cal:175, tags:["meat"], optIn:true },
    { id:7,  name:"סינטה בקר",           prep:"צלוי",       p:26.3, c:0.0,  f:11.0, fib:0,   cal:207, tags:["meat"], optIn:true },
    { id:8,  name:"סלמון",               prep:"אפוי",       p:22.1, c:0.0,  f:12.8, fib:0,   cal:206, tags:["fish"], optIn:true },
    { id:9,  name:"טונה בשמן",           prep:"שימורים",    p:26.0, c:0.0,  f:8.0,  fib:0,   cal:184, tags:["fish","tuna"], maxDay:160 },
    { id:10, name:"טונה במים",           prep:"שימורים",    p:25.5, c:0.0,  f:1.0,  fib:0,   cal:109, tags:["fish","tuna"], maxDay:160 },
    { id:11, name:"בקלה",                prep:"אפוי",       p:23.0, c:0.0,  f:0.9,  fib:0,   cal:105, tags:["fish"], optIn:true },
    { id:12, name:"דג בורי",             prep:"אפוי",       p:24.8, c:0.0,  f:6.3,  fib:0,   cal:159, tags:["fish"], optIn:true },
    { id:13, name:"מוסר ים",             prep:"אפוי",       p:22.4, c:0.0,  f:3.5,  fib:0,   cal:124, tags:["fish"], optIn:true },
    { id:14, name:"דג אמנון",            prep:"אפוי",       p:26.1, c:0.0,  f:2.6,  fib:0,   cal:128, tags:["fish"], optIn:true },
    { id:15, name:'ביצה M',               prep:"",           p:12.6, c:1.1,  f:10.6, fib:0,   cal:155, tags:["egg"], maxDay:106, isEgg:true, unitG:53 },
    { id:16, name:'ביצה L',               prep:"",           p:12.6, c:1.1,  f:10.6, fib:0,   cal:155, tags:["egg"], maxDay:126, isEgg:true, unitG:63 },
    { id:17, name:'ביצה XL',              prep:"",           p:12.6, c:1.1,  f:10.6, fib:0,   cal:155, tags:["egg"], maxDay:146, isEgg:true, unitG:73 },
  ],
  "מוצרי חלב": [
    { id:20, name:"קוטג' 5%",            prep:"", p:11.0, c:3.5,  f:4.0,  fib:0,   cal:90,  tags:["dairy"], unitG:250, unitLabel:"קופסה (250g)",  halfLabel:"חצי קופסה (125g)" },
    { id:21, name:"קוטג' 3%",            prep:"", p:11.0, c:3.5,  f:2.5,  fib:0,   cal:75,  tags:["dairy"], unitG:250, unitLabel:"קופסה (250g)",  halfLabel:"חצי קופסה (125g)" },
    { id:22, name:"יוגורט PRO",          prep:"", p:10.0, c:5.0,  f:0.0,  fib:0,   cal:65,  tags:["dairy"], unitG:200, unitLabel:"גביע (200g)", plural:"גביעים (200g)" },
    { id:23, name:"יוגורט יווני 0%",    prep:"", p:8.4,  c:5.0,  f:0.0,  fib:0,   cal:54,  tags:["dairy"], unitG:150, unitLabel:"גביע (150g)", plural:"גביעים (150g)" },
    { id:24, name:"יוגורט יווני 5%",    prep:"", p:9.0,  c:4.0,  f:5.0,  fib:0,   cal:97,  tags:["dairy"], unitG:150, unitLabel:"גביע (150g)", plural:"גביעים (150g)" },
    { id:25, name:"גבינה לבנה 5%",      prep:"", p:7.5,  c:3.5,  f:5.5,  fib:0,   cal:93,  tags:["dairy"], unitG:100 },
    { id:26, name:"גבינה צהובה",         prep:"", p:24.0, c:1.0,  f:23.0, fib:0,   cal:310, tags:["dairy"], unitG:15,  unitLabel:"פרוסה אחת", plural:"פרוסות", maxMeal:60 },   // עד 4 פרוסות לארוחה — נמדדו "9 פרוסות" לא ריאליות
    { id:27, name:"חלב 3%",              prep:"", p:3.2,  c:4.8,  f:3.2,  fib:0,   cal:61,  tags:["dairy"], unitG:250, unitLabel:"כוס (250ml)", drink:true },
  ],
  "דגנים": [
    { id:33, name:"אורז לבן מבושל",     prep:"", p:2.7, c:28.2, f:0.3, fib:0.4, cal:130, tags:["grain","hot_carb"] },
    { id:34, name:"אורז מלא מבושל",     prep:"", p:2.6, c:23.5, f:0.9, fib:1.8, cal:112, tags:["grain","hot_carb"] },
    { id:35, name:"פסטה מבושלת",        prep:"", p:5.8, c:31.0, f:0.9, fib:1.8, cal:158, tags:["grain","hot_carb","gluten"] },
    { id:36, name:"פסטה מלאה מבושלת",  prep:"", p:5.3, c:23.2, f:1.0, fib:4.5, cal:124, tags:["grain","hot_carb","gluten"] },
    { id:37, name:"לחם מלא",            prep:"", p:13.0, c:41.0, f:3.4, fib:7.0, cal:247, tags:["grain","bread","gluten"], unitG:30,  unitLabel:"פרוסה אחת", plural:"פרוסות" },
    { id:38, name:"לחם שיפון",          prep:"", p:8.5, c:48.0, f:3.3, fib:5.8, cal:259, tags:["grain","bread","gluten"], unitG:30,  unitLabel:"פרוסה אחת", plural:"פרוסות" },
    { id:39, name:"פיתה מלאה",          prep:"", p:8.5, c:48.0, f:1.5, fib:6.0, cal:239, tags:["grain","bread","gluten"], unitG:65,  unitLabel:"פיתה אחת", plural:"פיתות", pita:true },
    { id:40, name:"פיתה לבנה",          prep:"", p:7.5, c:52.0, f:1.2, fib:2.2, cal:255, tags:["grain","bread","gluten"], unitG:65,  unitLabel:"פיתה אחת", plural:"פיתות", pita:true },
    { id:41, name:"שיבולת שועל במים",   prep:"מבושל", p:2.5, c:12.0, f:1.5, fib:1.7, cal:71,  tags:["grain","breakfast","gluten"] },
    { id:106,name:"שיבולת שועל בחלב",   prep:"מבושל", p:4.8, c:15.0, f:3.8, fib:1.6, cal:116, tags:["grain","breakfast","gluten"], containsMilk:true, complete:true },
    { id:107,name:"גרנולה",             prep:"", p:9.0, c:64.0, f:15.0, fib:7.0, cal:450, tags:["grain","granola","gluten"], containsNuts:true, unitG:45, unitLabel:"מנה (45g)" },
    { id:111,name:"דבש",                prep:"", p:0.3, c:82.0, f:0,    fib:0,   cal:304, tags:["sweet_topping"], topping:true, unitG:10, unitLabel:"כפית (10g)" },
    { id:112,name:"סילן",               prep:"", p:1.5, c:73.0, f:0,    fib:0.5, cal:290, tags:["sweet_topping"], topping:true, unitG:15, unitLabel:"כפית (15g)" },
    { id:108,name:"קורנפלקס",           prep:"", p:7.0, c:84.0, f:0.4, fib:3.0, cal:357, tags:["grain","cereal","gluten"],  unitG:30, unitLabel:"מנה (30g)" },
    { id:42, name:"קינואה מבושלת",      prep:"", p:4.4, c:21.3, f:1.9, fib:2.8, cal:120, tags:["grain","hot_carb"] },
    { id:43, name:"כוסמת מבושלת",       prep:"", p:3.4, c:20.0, f:0.6, fib:2.7, cal:92,  tags:["grain","hot_carb"] },
    { id:44, name:"בורגול מבושל",       prep:"", p:3.1, c:18.6, f:0.2, fib:4.5, cal:83,  tags:["grain","hot_carb","gluten"] },
    { id:45, name:"פריכיות אורז גדולות", prep:"", p:7.8, c:80.7, f:3.5, fib:3.5, cal:384, tags:["grain","bread","cracker"], unitG:9,  unitLabel:"פריכייה אחת" },
    { id:46, name:"פריכיות תירס",       prep:"", p:8.5, c:79.0, f:3.5, fib:4.0, cal:384, tags:["grain","bread","cracker"], unitG:9,  unitLabel:"פריכייה אחת" },
    { id:100,name:"פריכיות אורז דקות",  prep:"", p:7.8, c:80.7, f:3.5, fib:3.5, cal:384, tags:["grain","bread","cracker"], unitG:4,  unitLabel:"פריכייה דקה" },
    { id:109,name:"לחם ללא גלוטן",       prep:"", p:4.0, c:47.0, f:4.0, fib:3.5, cal:250, tags:["grain","bread"], unitG:30, unitLabel:"פרוסה אחת", plural:"פרוסות", gfOnly:true },
    { id:110,name:"פסטה ללא גלוטן מבושלת", prep:"", p:3.5, c:25.0, f:0.6, fib:1.5, cal:120, tags:["grain","hot_carb"], gfOnly:true },
  ],
  "ירקות עמילניים": [
    { id:47, name:"בטטה",               prep:"אפויה", p:2.0, c:21.0, f:0.1, fib:3.0, cal:90,  tags:["starch","hot_carb"], unitG:150, unitLabel:"בטטה בינונית",      plural:"בטטות בינוניות" },
    { id:48, name:"תפוח אדמה",          prep:"אפוי",  p:2.5, c:21.2, f:0.1, fib:2.2, cal:93,  tags:["starch","hot_carb"], unitG:150, unitLabel:"תפוח אדמה בינוני",  plural:"תפוחי אדמה בינוניים" },
    { id:49, name:"תירס מבושל",         prep:"",       p:3.4, c:25.0, f:1.3, fib:2.4, cal:108, tags:["starch","hot_carb"], unitG:200, unitLabel:"קלח תירס",          plural:"קלחי תירס" },
  ],
  "קטניות": [
    { id:50, name:"עדשים מבושלות",      prep:"", p:9.0,  c:20.1, f:0.4, fib:7.9, cal:116, tags:["legume"] },
    { id:51, name:"חומוס מבושל",        prep:"", p:8.9,  c:27.4, f:2.6, fib:7.6, cal:164, tags:["legume"] },
    { id:52, name:"חומוס ממרח",         prep:"", p:7.9,  c:14.3, f:9.6, fib:6.0, cal:177, tags:["legume","sesame"], dip:true },   // ממרח חומוס מכיל טחינה (שומשום) — מוחרג לאלרגיים
    { id:53, name:"שעועית לבנה",        prep:"", p:9.7,  c:25.4, f:0.4, fib:6.3, cal:139, tags:["legume"] },
    { id:54, name:"שעועית שחורה",       prep:"", p:8.9,  c:23.7, f:0.5, fib:8.7, cal:132, tags:["legume"] },
    { id:55, name:"אפונה מבושלת",       prep:"", p:5.4,  c:15.6, f:0.2, fib:5.5, cal:84,  tags:["legume"] },
    { id:56, name:"טופו",               prep:"אפוי", p:17.3, c:2.8, f:8.7, fib:0.9, cal:144, tags:["legume","soy"], vegOnly:true },
    { id:57, name:"אדממה",              prep:"", p:11.9, c:8.9,  f:5.2, fib:5.2, cal:121, tags:["legume","soy"], optIn:true },
    { id:58, name:"סייטן",              prep:"מוקפץ/אפוי", p:24.0, c:4.0, f:1.5, fib:0.6, cal:130, tags:["legume","gluten"], vegOnly:true },
  ],
  "ירקות": [
    { id:60, name:"ברוקולי",            prep:"מאודה",  p:2.4, c:7.2,  f:0.4, fib:2.6, cal:35, tags:["veg","hot_veg"],    unitG:80,  unitLabel:"כוס פרחים (80g)" },
    { id:61, name:"כרובית",             prep:"מאודה",  p:2.0, c:5.3,  f:0.3, fib:2.0, cal:25, tags:["veg","hot_veg"],    unitG:100, unitLabel:"רבע כרובית" },
    { id:62, name:"תרד",                prep:"מבושל",  p:3.0, c:3.8,  f:0.3, fib:2.2, cal:23, tags:["veg","hot_veg"],    unitG:80,  unitLabel:"חופן עלים" },
    { id:63, name:"מנגולד",             prep:"מבושל",  p:1.9, c:4.1,  f:0.1, fib:1.6, cal:20, tags:["veg","hot_veg"],    unitG:80,  unitLabel:"חופן עלים", optIn:true },
    { id:64, name:"עגבנייה",            prep:"",       p:0.9, c:3.9,  f:0.2, fib:1.2, cal:18, tags:["veg","salad"],      unitG:120, unitLabel:"עגבנייה בינונית" },
    { id:65, name:"מלפפון",             prep:"",       p:0.7, c:3.6,  f:0.1, fib:0.5, cal:15, tags:["veg","salad"],      unitG:150, unitLabel:"מלפפון בינוני" },
    { id:66, name:"פלפל אדום",          prep:"",       p:1.0, c:7.2,  f:0.3, fib:2.1, cal:31, tags:["veg","salad"],      unitG:80,  unitLabel:"חצי פלפל אדום" },
    { id:67, name:"פלפל צהוב",          prep:"",       p:1.0, c:6.3,  f:0.2, fib:1.0, cal:27, tags:["veg","salad"],      unitG:80,  unitLabel:"חצי פלפל צהוב" },
    { id:68, name:"גזר",                prep:"",       p:0.9, c:9.6,  f:0.2, fib:2.8, cal:41, tags:["veg","salad"],      unitG:100, unitLabel:"גזר בינוני" },
    { id:69, name:"חציל",               prep:"אפוי",  p:0.8, c:8.1,  f:0.2, fib:3.0, cal:33, tags:["veg","hot_veg"],    unitG:200, unitLabel:"חציל בינוני" },
    { id:70, name:"קישוא",              prep:"מבושל", p:1.2, c:3.1,  f:0.4, fib:1.0, cal:17, tags:["veg","hot_veg"],    unitG:180, unitLabel:"קישוא בינוני" },
    { id:71, name:"בצל",                prep:"",       p:1.4, c:10.0, f:0.1, fib:1.7, cal:44, tags:["veg","salad_only"], unitG:60,  unitLabel:"חצי בצל" },
    { id:72, name:"פטריות",             prep:"מבושלות",p:3.1, c:3.3, f:0.3, fib:1.0, cal:22, tags:["veg","hot_veg"],    unitG:80,  unitLabel:"חופן פטריות" },
    { id:73, name:"כרוב",               prep:"",       p:1.3, c:5.8,  f:0.1, fib:2.5, cal:25, tags:["veg","salad_only"], unitG:80,  unitLabel:"פרוסת כרוב" },
    { id:74, name:"חסה",                prep:"",       p:1.4, c:2.9,  f:0.2, fib:1.3, cal:15, tags:["veg","salad_only"], unitG:60,  unitLabel:"קערת חסה" },
  ],
  "פירות": [
    { id:75, name:"בננה",               prep:"", p:1.1, c:22.8, f:0.3, fib:2.6, cal:89,  tags:["fruit"], unitG:120, unitLabel:"בננה בינונית", plural:"בננות בינוניות" },
    { id:76, name:"תפוח",               prep:"", p:0.3, c:14.0, f:0.2, fib:2.4, cal:52,  tags:["fruit"], unitG:182, unitLabel:"תפוח בינוני", plural:"תפוחים בינוניים" },
    { id:77, name:"אגס",                prep:"", p:0.4, c:15.2, f:0.1, fib:3.1, cal:57,  tags:["fruit"], unitG:178, unitLabel:"אגס בינוני", plural:"אגסים בינוניים" },
    { id:78, name:"תפוז",               prep:"", p:0.9, c:11.8, f:0.1, fib:2.4, cal:47,  tags:["fruit"], unitG:131, unitLabel:"תפוז בינוני", plural:"תפוזים בינוניים" },
    { id:79, name:"תמר מג'הול",        prep:"", p:1.8, c:74.9, f:0.2, fib:6.7, cal:277, tags:["fruit"], unitG:24,  unitLabel:"תמר אחד", plural:"תמרים" },
    { id:80, name:"אבטיח",              prep:"", p:0.6, c:7.6,  f:0.2, fib:0.4, cal:30,  tags:["fruit"], unitG:200, unitLabel:"פרוסה גדולה", optIn:true },
    { id:81, name:"תות שדה",            prep:"", p:0.7, c:7.7,  f:0.3, fib:2.0, cal:32,  tags:["fruit"], unitG:150, unitLabel:"קערת תותים", plural:"קערות תותים" },
    { id:82, name:"מנגו",               prep:"", p:0.8, c:15.0, f:0.4, fib:1.6, cal:60,  tags:["fruit"], unitG:150, unitLabel:"חצי מנגו" },
    { id:83, name:"אשכולית",            prep:"", p:0.8, c:10.7, f:0.1, fib:1.6, cal:42,  tags:["fruit"], unitG:246, unitLabel:"אשכולית שלמה", optIn:true },
    { id:102,name:"נקטרינה",           prep:"", p:1.1, c:10.6, f:0.3, fib:1.7, cal:44,  tags:["fruit"], unitG:142, unitLabel:"נקטרינה בינונית", plural:"נקטרינות" },
    { id:103,name:"אפרסק",             prep:"", p:0.9, c:9.5,  f:0.3, fib:1.5, cal:39,  tags:["fruit"], unitG:150, unitLabel:"אפרסק בינוני", plural:"אפרסקים" },
    { id:104,name:"שזיף",              prep:"", p:0.7, c:11.4, f:0.3, fib:1.4, cal:46,  tags:["fruit"], unitG:66,  unitLabel:"שזיף אחד", plural:"שזיפים" },
    { id:105,name:"קלמנטינה",          prep:"", p:0.9, c:12.0, f:0.2, fib:1.7, cal:47,  tags:["fruit"], unitG:74,  unitLabel:"קלמנטינה אחת", plural:"קלמנטינות" },
  ],
  "שומנים": [
    { id:86, name:"שמן זית",            prep:"", p:0.0,  c:0.0,  f:100.0, fib:0,    cal:884, tags:["fat","oil"],      unitG:14, unitLabel:"כף שמן", condiment:true },
    { id:87, name:"אבוקדו",             prep:"", p:2.0,  c:8.5,  f:14.7,  fib:6.7,  cal:160, tags:["fat"],            unitG:100, unitLabel:"חצי אבוקדו" },
    { id:88, name:"שקדים",              prep:"", p:21.2, c:21.6, f:49.9,  fib:12.5, cal:579, tags:["fat","nuts"],     unitG:30,  unitLabel:"חופן שקדים" },
    { id:89, name:"אגוזי מלך",          prep:"", p:15.2, c:13.7, f:65.2,  fib:6.7,  cal:654, tags:["fat","nuts"],     unitG:30,  unitLabel:"חופן אגוזים" },
    { id:90, name:"אגוזי קשיו",         prep:"", p:18.2, c:30.2, f:43.8,  fib:3.3,  cal:553, tags:["fat","nuts"],     unitG:30,  unitLabel:"חופן קשיו" },
    { id:91, name:"טחינה גולמית",       prep:"", p:17.0, c:21.2, f:53.0,  fib:9.3,  cal:595, tags:["fat","sesame"],   unitG:15,  unitLabel:"כף טחינה", condiment:true, dip:true },
    { id:92, name:"חמאת בוטנים",        prep:"", p:25.1, c:20.1, f:50.4,  fib:6.0,  cal:588, tags:["fat","peanuts"],  unitG:16,  unitLabel:"כף חמאת בוטנים", condiment:true },
    { id:93, name:"זיתים",              prep:"", p:0.9,  c:5.0,  f:13.0,  fib:3.2,  cal:120, tags:["fat"],            unitG:5,   unitLabel:"זית אחד", plural:"זיתים" },
  ],
  "תוספים": [
    { id:96, name:"אבקת חלבון מי גבינה", prep:"", p:75.0, c:7.0, f:5.0, fib:1.0, cal:380, tags:["supplement"], containsMilk:true, unitG:30, unitLabel:"סקופ אחד (30g)" },   // וויי = מוצר חלב — מחריג טבעוני/lactose (לטבעונים יש אבקת חלבון צמחי 97)
    { id:97, name:"אבקת חלבון צמחי",    prep:"", p:70.0, c:8.0, f:6.0, fib:3.0, cal:360, tags:["supplement"], unitG:30, unitLabel:"סקופ אחד (30g)" },
    { id:98, name:"קזאין",              prep:"", p:72.0, c:9.0, f:4.5, fib:1.0, cal:370, tags:["supplement"], containsMilk:true, unitG:30, unitLabel:"סקופ אחד (30g)" },   // קזאין = מוצר חלב — מחריג טבעוני/lactose
    { id:99, name:"בר חלבון",           prep:"", p:21.0, c:20.0,f:6.0, fib:5.0, cal:190, tags:["supplement"], containsMilk:true, containsNuts:true, unitG:60, unitLabel:"בר אחד (60g)" },   // ברי חלבון לרוב על בסיס חלב + מכילים אגוזים
    { id:101,name:"חטיף אנרגיה",       prep:"", p:9.0,  c:64.0,f:7.0, fib:4.0, cal:380, tags:["supplement","gluten"], containsNuts:true, unitG:65, unitLabel:"חטיף אחד (65g)" },
  ],
};

// ── פינוקים (ids 200+) — לא חלק מה-DB ולא מופיעים במסכי הבחירה ──
// ערכים ל-100g כמו בשאר המאגר; unitG = גודל המנה. משמשים את כפתור הפינוק ואת "אכלתי משהו אחר".
const TREATS = [
  { id:200, name:"קפה הפוך",            prep:"", p:2.6,  c:3.6,  f:1.9,  fib:0,   cal:46,  tags:["treat"], unitG:240, unitLabel:"כוס (240 מ\"ל)" },
  { id:210, name:"קפה הפוך גדול",       prep:"", p:2.6,  c:3.6,  f:1.9,  fib:0,   cal:46,  tags:["treat"], unitG:350, unitLabel:"כוס גדולה (350 מ\"ל)" },
  { id:211, name:"קפה הפוך (סויה)",     prep:"", p:2.5,  c:2.2,  f:1.6,  fib:0,   cal:40,  tags:["treat"], unitG:240, unitLabel:"כוס (240 מ\"ל)" },
  { id:213, name:"קפה שחור",            prep:"", p:0,    c:0,    f:0,    fib:0,   cal:0,   tags:["treat"], unitG:150, unitLabel:"כוס קטנה (150 מ\"ל)" },
  { id:214, name:"נס קפה (עם חלב)",     prep:"", p:1.4,  c:2.4,  f:0.9,  fib:0,   cal:21,  tags:["treat"], unitG:240, unitLabel:"כוס (240 מ\"ל)" },
  { id:201, name:"קולה זירו",       prep:"", p:0,    c:0,    f:0,    fib:0,   cal:0,   tags:["treat"], unitG:330, unitLabel:"פחית (330 מ\"ל)" },
  { id:202, name:"קולה",            prep:"", p:0,    c:10.6, f:0,    fib:0,   cal:42,  tags:["treat"], unitG:330, unitLabel:"פחית (330 מ\"ל)" },
  { id:203, name:"בירה",            prep:"", p:0.5,  c:3.6,  f:0,    fib:0,   cal:43,  tags:["treat"], unitG:330, unitLabel:"בקבוק (330 מ\"ל)" },
  { id:204, name:"חטיף שוקולד",     prep:"", p:7.0,  c:55.0, f:30.0, fib:2.0, cal:530, tags:["treat"], unitG:50,  unitLabel:"חטיף (50g)" },
  { id:212, name:"שוקולד (פס קטן)", prep:"", p:7.0,  c:58.0, f:32.0, fib:1.0, cal:540, tags:["treat"], unitG:13,  unitLabel:"פס קטן (13g)" },
  { id:205, name:"גלידה",           prep:"", p:3.5,  c:24.0, f:10.0, fib:0.5, cal:200, tags:["treat"], unitG:100, unitLabel:"2 כדורים (100g)" },
  { id:206, name:"משולש פיצה",      prep:"", p:9.0,  c:30.0, f:8.0,  fib:1.5, cal:230, tags:["treat"], unitG:130, unitLabel:"משולש (130g)" },
  { id:207, name:"המבורגר",         prep:"", p:13.0, c:20.0, f:11.0, fib:1.2, cal:230, tags:["treat"], unitG:250, unitLabel:"מנה (250g)" },
  { id:208, name:"שווארמה בפיתה",   prep:"", p:11.0, c:14.0, f:7.0,  fib:1.0, cal:160, tags:["treat"], unitG:450, unitLabel:"מנה (450g)" },
  { id:209, name:"פלאפל בפיתה",     prep:"", p:6.0,  c:18.0, f:5.0,  fib:2.5, cal:135, tags:["treat"], unitG:400, unitLabel:"מנה (400g)" },
];

// תבניות שעות ארוחות לפי זמן אימון
const MEAL_TIMES = {
  noTrain: [
    { label:'ארוחת בוקר',   icon:'sun',       time:'08:00', pct:.22, tag:null,   type:'breakfast', big:false },
    { label:'ארוחת צהריים', icon:'sun-high',   time:'12:00', pct:.33, tag:null,   type:'hot',       big:true  },
    { label:'ארוחת אחה"צ',  icon:'coffee',     time:'17:30', pct:.18, tag:null,   type:'snack',     big:false },
    { label:'ארוחת ערב',    icon:'moon',       time:'22:00', pct:.27, tag:null,   type:'dinner',    big:false },
  ],
  // אימון בוקר היה הלוח היחיד עם 3 ארוחות, ואיתו הפער הארוך ביותר ביום (13:00→20:00, שבע שעות)
  // בזמן שביום ללא אימון דווקא יש נשנוש ב-17:30. התוצאה: הצלחת הגדולה נשאה ~39-41% מהיום
  // ביעדים מתחת ל-2,100 (מעליהם mealPlan מוסיף נשנושים בעצמו, אז שם זה לא הורגש).
  // נמדד (600 תפריטים לכל וריאנט): הצלחת הגדולה 40.8%→34.1% בחיטוב ו-38.9%→33.5% בשמירה,
  // דיוק קלוריות וחלבון ללא שינוי, והארוחה הקטנה נשארת ארוחה אמיתית גם ביעד הנמוך ביותר (~172 קק"ל).
  morning: [
    { label:'אחרי אימון',   icon:'bolt',       time:'07:30', pct:.30, tag:'post', type:'breakfast', big:true  },
    { label:'ארוחת צהריים', icon:'sun-high',   time:'13:00', pct:.25, tag:null,   type:'hot',       big:true  },
    { label:'ארוחת אחה"צ',  icon:'coffee',     time:'16:30', pct:.13, tag:null,   type:'snack',     big:false },
    { label:'ארוחת ערב',    icon:'moon',       time:'20:00', pct:.32, tag:null,   type:'dinner',    big:false },
  ],
  noon: [
    { label:'ארוחת בוקר',   icon:'sun',        time:'08:00', pct:.20, tag:null,   type:'breakfast', big:false },
    { label:'לפני אימון',   icon:'sun-high',   time:'12:00', pct:.30, tag:'pre',  type:'hot',       big:true  },
    { label:'אחרי אימון',   icon:'bolt',       time:'16:00', pct:.30, tag:'post', type:'hot',       big:true  },
    { label:'ארוחת ערב',    icon:'moon',       time:'21:00', pct:.20, tag:null,   type:'dinner',    big:false },
  ],
  evening: [
    { label:'ארוחת בוקר',   icon:'sun',        time:'08:00', pct:.20, tag:null,   type:'breakfast', big:false },
    { label:'ארוחת צהריים', icon:'sun-high',   time:'12:30', pct:.30, tag:null,   type:'hot',       big:true  },
    { label:'לפני אימון',   icon:'moon',       time:'17:30', pct:.30, tag:'pre',  type:'hot',       big:true  },
    { label:'אחרי אימון',   icon:'bolt',       time:'21:30', pct:.20, tag:'post', type:'dinner',    big:false },
  ],
};
