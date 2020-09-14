# PMForce
This project contains the crawling infrastructure and the complete in-browser pipeline for our ACM CCS 2020 paper "PMForce: Systematically Analyzing postMessage Handlers at Scale", which we used to analyze the security and privacy sensitive behavior of postMessage handlers.
You can find the final version of the paper located [here](https://swag.cispa.saarland/papers/steffens2020pmforce.pdf).  
We hope that the general crawling framework might be found useful for other empirical measurements of the Web and that our instantiation with an analysis that finds postMessage handler related issues assists developers in hardening their applications.

## Setup
Our pipeline can easily be tested by making use of Docker.
In the projects root execute the following command:
```bash
docker-compose build && docker-compose up
```
This will spawn a postgres container which serves as a test DB together with an Ubuntu container in which all dependencies are setup.  
You can enter the container by:
```bash
docker-compose exec crawly bash
```
## Analysis Pipeline
Our Analysis pipeline is contained in ```src/external/pm``` where external means that it is not directly part of our crawling framework but only used inside the analysis module.  
```src/external/pm/dist``` contains the packed version which will be injected into every frame that our crawlers visit.   
It can be obtained by running ```webpack -d``` in ```src/external/pm```, which is not needed as long as there are no changes to the pipeline, as ```src/external/pm/dist``` contains the most recent packed version.  
```src/external/pm/Analyzer.js``` contains the starting point of our analysis of a given handler.  
```src/external/pm/python/``` contains our Constraint Solving routine that interacts with Z3. It takes as input the constraints provided by the crawler and outputs the results of Z3.

## Crawling 
The crawling infrastructure is contained in ```src/core``` which can be interacted with using ```crawly.js```.  
It uses what we call Modules to selectively enable specific experiments, e.g., our PM analysis pipeline, which are contained in ```src/modules```.  
This module essentially injects our pipeline, contained in ```src/external/pm``` , into every frame and collects the results from the pipeline.
Modules can be tested on specific URLs using the following command:  
```bash
node crawly.js --mode test --headless --module pm --url 'http://127.0.0.1:8000/conditionalOr.html'
```   
The test mode will output two Maps to the console prior to finishing the analysis which contain the generated exploit candidates and the succesfully validated ones.

Modules can also be run on a set of URLs, e.g., as was the case for our experiment. To illustrate this functionality we can run all our test cases automatically:  
```bash
chmod +x spawn.sh keepalive.sh
sh local_test.sh
./spawn.sh 1 1 --mode run --job_id 1 --module pm --headless
```   
The first script sets up the database and fills it with all out test urls locally hosted inside the Docker and the second command spawns one crawler that keeps crawling until all URLs are analyzed.  
Be aware that this process might take some time, but you can monitor the progress in the DB.

## Database
You can connect to the database, either by exposing the postgres port from the db docker to your host machine, or within the container execute the following command:
```bash
psql -Ucrawly -hdb
``` 
The password is configured in the ```docker-compose.yaml```.

The ```url``` table stores all the information about the success and failure of added URLs. If you have started the local tests there will be 16 entries which consist of the test suite that you can find in ```tests```.  
The ```handler``` table stores all the information about the collected handlers, ```base_constraints``` associates handlers with the path constraints of interesting traces which had a sink access.  
The ```exploit_candidates``` table stores the constraints of the sink object with the respective Exploit Template applied and contains further information about the solved assignments, or the corresponding error if the constraints were unsolvable.  
The ```report``` table provides information about which of the candidates lead to a validated flaw.  

Overall, a query that checks for the success of all of our test cases would look like this:
```
SELECT DISTINCT url_id FROM url JOIN handler USING(url_id) JOIN base_constraints USING(handler_id) JOIN exploit_candidates USING(constraint_id) JOIN report USING(exploit_id) ORDER BY 1;
```
Be aware that all URLs need to be successfully crawled, which is indicated by a crawl_status of 1 in the URL table:
```
SELECT * FROM url;
```

## Caveats
- Pinning z3-solver to version 4.8.7.0 is needed due to our test cases timing out in the newest version(4.8.8) of z3. This bug surfaced before making the code available and needs further investigation.  
- Running this pipeline outside of the Docker incurs issues with zombie chrome processes(e.g., if the chrome process unexpectedly disconnects). Docker automatically reaps such processes, however, if you happen to run this project outside of the docker be aware that you need to take care of them yourself.  
- The PoC messages saved to the database are encoded since they may contain non-printable characters. This is mostly an artefact of the constraint solving engine adding arbitrary bytes which are not necessarily needed to fulfill the constraints of the program. Most of the time they can be safely discarded or substituted with printable characters to make the PoC more readable.

## Licensing
We built atop multiple projects that are licensed under the MIT license and any of our changes remains available under the MIT license.
In particular ```src/external/pm/iroh.js``` is part of the Iroh project available at https://github.com/maierfelix/Iroh, ```src/external/pm/evaluationHelper``` is part of the ExposeJS project available at https://github.com/ExpoSEJS/ExpoSE.
```src/external/pm/python/regex_parser.py``` is part of a crossword solving project available at https://github.com/blukat29/regex-crossword-solver.
Further licensing information can be found at the beginning of each of those files.

The rest of our frame work is licensed under the GNU Affero General Public License as indicated in the ```LICENSE``` file and at the top of each of the source code files. 

