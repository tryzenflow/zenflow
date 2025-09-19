python -m venv venv &&
source venv/Scripts/Activate &&
pip install -r requirements.txt &&
sh gen_proto.sh &&
python main.py